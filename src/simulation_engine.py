"""
Core simulation engine.
Manages vehicles, intersections, and simulation state.
Phase 10: Intelligent V2V Routing — receiver-aware messaging, EVA, ICA.
Phase 11: Emergency Vehicle Priority & Speed Multipliers.
"""

import math
import random
from .intersection_manager import IntersectionManager


# ============================================================
# V2V CONFIGURATION
# ============================================================

# BSM — Basic Safety Message (vehicle → nearby vehicles)
BSM_RANGE_M    = 80.0
BSM_TTL_TICKS  = 3

# SPAT — Signal Phase and Timing (infrastructure → nearby vehicles)
SPAT_RANGE_M   = 120.0

# MAP — Map data message (infrastructure → broadcast)
MAP_RANGE_M        = 150.0
MAP_INTERVAL_TICKS = 30
MAP_TTL_TICKS      = 90

# EVA — Emergency Vehicle Alert (emergency vehicle → nearby vehicles)
EVA_RANGE_M    = 200.0

# ICA — Intersection Collision Alert (vehicle → conflicting vehicle)
ICA_RANGE_M    = 60.0
ICA_TTL_TICKS  = 6

# Speed multiplier applied to non-emergency vehicles that are
# within EVA_RANGE_M of an active emergency vehicle for that tick.
# 0.35 = vehicle moves at 35% of its base speed while yielding.
# This is intentionally conservative — visible but not a full stop.
EVA_YIELD_FACTOR = 0.35
EVA_YIELD_RANGE_M     = 300.0

class Vehicle:
    """Represents a single vehicle in simulation."""

    def __init__(self, id, lane_id, position=0.0, speed=5.0, vehicle_type="car"):
        self.id           = id
        self.lane_id      = lane_id
        self.position     = position
        self.speed        = speed
        self.base_speed   = speed
        self.type         = vehicle_type
        self.acceleration = 0.0

    def update(self, dt):
        self.position += self.speed * dt

    def __repr__(self):
        return f"Vehicle({self.id}, lane={self.lane_id}, pos={self.position:.2f})"


class SimulationEngine:
    """
    Main simulation engine.
    Orchestrates vehicle updates, intersection logic, and V2V message generation.

    Message ownership:
        BSM  — generated once per vehicle per get_state() call,
               targeted to vehicles within BSM_RANGE_M
        SPAT — generated once per intersection per get_state() call,
               targeted to vehicles within SPAT_RANGE_M
        MAP  — generated once per intersection every MAP_INTERVAL_TICKS ticks,
               broadcast (receiver_uid = None)
        EVA  — generated once per emergency vehicle per get_state() call,
               targeted to vehicles within EVA_RANGE_M
        ICA  — generated once per converging pair per intersection per tick,
               point-to-point (receiver_uid = conflicting vehicle uid)
    """

    def __init__(self, road_network):
        self.road_network         = road_network
        self.vehicles             = []
        self.tick                 = 0
        self.time                 = 0.0
        self._msg_counter         = 0
        self._map_cache           = {}
        self._map_emit_tick       = {}

        self.intersection_manager = IntersectionManager(road_network.intersections)

        print(f"🎮 SimulationEngine initialized")
        print(f"   📍 Road Network: {len(road_network.roads)} roads, {len(road_network.lanes)} lanes")
        print(f"   🚦 Intersections: {len(road_network.intersections)}")
        print(f"   📍 Spawn Points: {len(road_network.spawn_points)}")

    # ------------------------------------------------------------------ #
    # SIMULATION LOOP                                                    #
    # ------------------------------------------------------------------ #

    def update(self, dt):
        """Advance simulation by one tick."""
        self.tick += 1
        self.time += dt

        try:
            self.intersection_manager.update(dt)
        except Exception as e:
            print(f"   ❌ Intersection update error: {e}")

        # ── Phase 11: build emergency vehicle position snapshot ──────────
        # Collect world [x, z] for every emergency vehicle BEFORE advancing any
        # position. Non-emergency vehicles that are within EVA_RANGE_M of
        # at least one emergency vehicle will be yielded this tick.
        emergency_positions = []
        for v in self.vehicles:
            if getattr(v, 'type', None) == 'emergency':
                pos = self._get_vehicle_world_pos(v)
                if pos:
                    emergency_positions.append(pos)
        # ── end Phase 11 snapshot ────────────────────────────────────────

        updated_vehicles = []
        for vehicle in self.vehicles:
            try:
                # ── Phase 11: compute yield multiplier ──────────────────────
                # Non-emergency vehicles reduce speed when an emergency vehicle
                # is within EVA_RANGE_M. Emergency vehicles are never slowed.
                if getattr(vehicle, 'type', None) != 'emergency' and emergency_positions:
                    v_pos = self._get_vehicle_world_pos(vehicle)
                    if v_pos:
                        vx, vz = v_pos[0], v_pos[1]
                        in_range = any(
                            ((vx - ex) ** 2 + (vz - ez) ** 2) <= EVA_YIELD_RANGE_M ** 2
                            for ex, ez in emergency_positions
                        )
                        if in_range:
                            if not hasattr(vehicle, 'base_speed'):
                                vehicle.base_speed = vehicle.speed
                            vehicle.speed = vehicle.base_speed * EVA_YIELD_FACTOR
                        else:
                            if hasattr(vehicle, 'base_speed'):
                                vehicle.speed = vehicle.base_speed
                # ── end Phase 11 yield ───────────────────────────────────────

                vehicle.update(dt)
                if vehicle.position > 1.0:
                    vehicle.position = 0.0  # recycle: wrap back to lane start
                updated_vehicles.append(vehicle)
            except Exception as e:
                print(f"   ❌ Vehicle update error: {e}")

        self.vehicles = updated_vehicles

    # ------------------------------------------------------------------ #
    # SPAWN / CLEAR                                                      #
    # ------------------------------------------------------------------ #

    def spawn_agents(self, config):
        """Spawn vehicles based on configuration."""
        vehicle_count = config.get('vehicles', 5)
        spawned = 0

        for i in range(vehicle_count):
            try:
                if self.road_network.spawn_points:
                    spawn_point = self.road_network.spawn_points[
                        i % len(self.road_network.spawn_points)
                    ]
                    vehicle = Vehicle(
                        id           = f"vehicle_{len(self.vehicles):04d}",
                        lane_id      = spawn_point.lane_id,
                        position     = spawn_point.position,
                        speed        = random.uniform(0.015, 0.045),
                        vehicle_type = config.get('vehicle_type', 'car')
                    )
                    self.vehicles.append(vehicle)
                    spawned += 1
            except Exception as e:
                print(f"   ❌ Spawn error: {e}")

        return {"total": spawned, "vehicles": spawned}

    def clear(self):
        """Clear all vehicles and reset simulation."""
        self.vehicles = []
        self.tick = 0
        self.time = 0.0
        self._msg_counter = 0
        self._map_cache = {}
        self._map_emit_tick = {}

    # ------------------------------------------------------------------ #
    # PRIVATE — POSITION & RANGE HELPERS                                 #
    # ------------------------------------------------------------------ #

    def _get_vehicle_world_pos(self, vehicle):
        """Helper to resolve a vehicle's world [x, z] position."""
        lane = self.road_network.get_lane(vehicle.lane_id)
        if lane is not None:
            road = self.road_network.get_road(lane.road_id)
            if road is not None and len(road.start) >= 2 and len(road.end) >= 2:
                pos_x = road.start[0] + (road.end[0] - road.start[0]) * vehicle.position
                pos_z = road.start[1] + (road.end[1] - road.start[1]) * vehicle.position
                return [round(pos_x, 3), round(pos_z, 3)]
        return [0.0, 0.0]

    def _vehicles_within_range(self, origin_pos, range_m, vehicle_positions,
                               exclude_uid=None):
        """
        Return a list of vehicle uids whose world position is within range_m
        of origin_pos.

        Args:
            origin_pos       : [x, z] world position of the sender
            range_m          : radius in metres
            vehicle_positions: dict of uid → [x, z]  (pre-built in get_state)
            exclude_uid      : uid to skip (the sender itself)

        Returns:
            list[str] of matching uids, or None if the list is empty.
            None preserves broadcast semantics for messages with no nearby peers.
        """
        results = []
        ox, oz  = origin_pos[0], origin_pos[1]
        r2      = range_m * range_m   # squared comparison avoids sqrt

        for uid, pos in vehicle_positions.items():
            if uid == exclude_uid:
                continue
            dx = pos[0] - ox
            dz = pos[1] - oz
            if dx * dx + dz * dz <= r2:
                results.append(uid)

        return results if results else None

    # ------------------------------------------------------------------ #
    # PRIVATE — MESSAGE GENERATORS                                       #
    # ------------------------------------------------------------------ #

    def _next_msg_id(self):
        """Return a unique, monotonically increasing message ID string."""
        self._msg_counter += 1
        return f"msg_{self._msg_counter:06d}"

    def _generate_bsm(self, vehicle_id, world_pos, nearby_uids=None):
        """
        Basic Safety Message — one per vehicle per tick.
        world_pos is already computed in get_state(); no duplicate interpolation.
        receiver_uid is the list of vehicles within BSM_RANGE_M, or None for
        broadcast when no peers are in range.
        """
        return {
            "id":           self._next_msg_id(),
            "tick":         self.tick,
            "ttl_ticks":    BSM_TTL_TICKS,
            "type":         "BSM",
            "sender_uid":   vehicle_id,
            "receiver_uid": nearby_uids,
            "pos":          world_pos,
            "range_m":      BSM_RANGE_M,
            "payload":      {}
        }

    def _generate_spat(self, intersection, signal_state, nearby_uids=None):
        """
        Signal Phase and Timing message — one per intersection per tick.
        receiver_uid is the list of vehicles within SPAT_RANGE_M, or None.
        """
        pos = getattr(intersection, 'position', [0.0, 0.0])
        return {
            "id":           self._next_msg_id(),
            "tick":         self.tick,
            "ttl_ticks":    6,
            "type":         "SPAT",
            "sender_uid":   f"spat_{intersection.id}",
            "receiver_uid": nearby_uids,
            "pos":          [round(pos[0], 3), round(pos[1], 3)],
            "range_m":      SPAT_RANGE_M,
            "payload": {
                "intersection_id": intersection.id,
                "signal_state":    signal_state,
            }
        }

    def _generate_map(self, intersection):
        """
        MAP message — topology broadcast.
        Transmitted infrequently (every MAP_INTERVAL_TICKS ticks).
        Always broadcast — receiver_uid stays None.
        Returns None when outside transmission window.
        """
        last_emit = self._map_emit_tick.get(intersection.id, -MAP_INTERVAL_TICKS)
        if self.tick - last_emit < MAP_INTERVAL_TICKS:
            return None

        self._map_emit_tick[intersection.id] = self.tick
        pos = getattr(intersection, 'position', [0.0, 0.0])

        return {
            "id":           self._next_msg_id(),
            "tick":         self.tick,
            "ttl_ticks":    MAP_TTL_TICKS,
            "type":         "MAP",
            "sender_uid":   f"map_{intersection.id}",
            "receiver_uid": None,
            "pos":          [round(pos[0], 3), round(pos[1], 3)],
            "range_m":      MAP_RANGE_M,
            "payload": {
                "intersection_id": intersection.id,
                "incoming_lanes":  getattr(intersection, 'incoming_lanes', []),
                "outgoing_lanes":  getattr(intersection, 'outgoing_lanes', []),
                "signal_id":       getattr(intersection, 'signal_id', None)
            }
        }

    def _generate_eva(self, vehicle_id, world_pos, nearby_uids=None):
        """
        Emergency Vehicle Alert — one per emergency vehicle per tick.
        Only called when vehicle.type == 'emergency'.
        receiver_uid is the list of vehicles within EVA_RANGE_M, or None
        for broadcast when no peers are in range.
        """
        return {
            "id":           self._next_msg_id(),
            "tick":         self.tick,
            "ttl_ticks":    30,
            "type":         "EVA",
            "sender_uid":   vehicle_id,
            "receiver_uid": nearby_uids,
            "pos":          world_pos,
            "range_m":      EVA_RANGE_M,
            "payload":      {}
        }

    def _generate_ica(self, vehicle_a_id, vehicle_b_id, intersection_id,
                      world_pos):
        """
        Intersection Collision Alert — emitted when two vehicles are
        simultaneously within ICA_RANGE_M of the same intersection,
        indicating a potential conflict.
        sender_uid  : the first vehicle of the converging pair
        receiver_uid: the second vehicle (point-to-point, not a list)
        pos         : midpoint between the two vehicles
        """
        return {
            "id":           self._next_msg_id(),
            "tick":         self.tick,
            "ttl_ticks":    ICA_TTL_TICKS,
            "type":         "ICA",
            "sender_uid":   vehicle_a_id,
            "receiver_uid": vehicle_b_id,
            "pos":          world_pos,
            "range_m":      ICA_RANGE_M,
            "payload": {
                "intersection_id": intersection_id,
                "conflict_uid":    vehicle_b_id
            }
        }

    # ------------------------------------------------------------------ #
    # STATE                                                              #
    # ------------------------------------------------------------------ #

    def get_state(self):
        """
        Get current simulation state including all active V2V messages.

        Message generation order per tick:
            1. BSM  — one per vehicle, targeted to vehicles within BSM_RANGE_M
            2. EVA  — one per emergency vehicle, targeted within EVA_RANGE_M
            3. SPAT — one per intersection, targeted to vehicles within SPAT_RANGE_M
            4. MAP  — one per intersection every MAP_INTERVAL_TICKS, broadcast
            5. ICA  — one per converging pair per intersection, point-to-point

        Returns:
            dict with keys: status, tick, time, vehicle_count,
                            intersections, roads, lanes, vehicles, messages
        """
        vehicle_list      = []
        message_list      = []
        vehicle_positions = {}   # uid → [x, z]  — shared by all range checks

        # ── Pass 1: resolve world positions for every vehicle ─────────────
        for v in self.vehicles[:20]:
            lane     = self.road_network.get_lane(v.lane_id)
            pos      = [0.0, 0.0]
            rotation = 0.0

            if lane is not None:
                road = self.road_network.get_road(lane.road_id)
                if road is not None and len(road.start) >= 2 and len(road.end) >= 2:
                    pos_x    = road.start[0] + (road.end[0] - road.start[0]) * v.position
                    pos_z    = road.start[1] + (road.end[1] - road.start[1]) * v.position
                    pos      = [round(pos_x, 3), round(pos_z, 3)]
                    rotation = math.atan2(
                        road.end[1] - road.start[1],
                        road.end[0] - road.start[0]
                    )

            vehicle_positions[v.id] = pos

            vehicle_list.append({
                "id":           v.id,
                "uid":          v.id,
                "lane_id":      v.lane_id,
                "position":     round(v.position, 3),
                "pos":          pos,
                "rotation":     rotation,
                "speed":        round(v.speed, 2),
                "type":         v.type,
                "is_emergency": v.type == 'emergency'
            })

        # ── 1 + 2: Vehicle messages (BSM + EVA) ───────────────────────────
        for v in self.vehicles[:20]:
            pos = vehicle_positions[v.id]

            # BSM — every vehicle broadcasts its position
            nearby = self._vehicles_within_range(
                pos, BSM_RANGE_M, vehicle_positions, exclude_uid=v.id
            )
            message_list.append(self._generate_bsm(v.id, pos, nearby))

            # EVA — emergency vehicles only
            if getattr(v, 'type', None) == 'emergency':
                nearby_eva = self._vehicles_within_range(
                    pos, EVA_RANGE_M, vehicle_positions, exclude_uid=v.id
                )
                message_list.append(self._generate_eva(v.id, pos, nearby_eva))

        # ── 3 + 4 + 5: Infrastructure messages (SPAT, MAP, ICA) ──────────
        for intersection in self.road_network.intersections:
            ipos = getattr(intersection, 'position', [0.0, 0.0])

            # SPAT
            signal_state = self.intersection_manager.get_signal_state(intersection.id)
            nearby_spat  = self._vehicles_within_range(
                ipos, SPAT_RANGE_M, vehicle_positions
            )
            message_list.append(
                self._generate_spat(intersection, signal_state, nearby_spat)
            )

            # MAP (throttled to every MAP_INTERVAL_TICKS)
            map_msg = self._generate_map(intersection)
            if map_msg:
                message_list.append(map_msg)

            # ICA — detect pairs of vehicles converging on this intersection
            at_inter = self._vehicles_within_range(
                ipos, ICA_RANGE_M, vehicle_positions
            )
            if at_inter and len(at_inter) >= 2:
                # One ICA per unique unordered pair (A,B) — not duplicated as (B,A)
                for i in range(len(at_inter)):
                    for j in range(i + 1, len(at_inter)):
                        uid_a = at_inter[i]
                        uid_b = at_inter[j]
                        pos_a = vehicle_positions[uid_a]
                        pos_b = vehicle_positions[uid_b]
                        mid   = [
                            round((pos_a[0] + pos_b[0]) / 2, 3),
                            round((pos_a[1] + pos_b[1]) / 2, 3)
                        ]
                        message_list.append(
                            self._generate_ica(
                                uid_a, uid_b, intersection.id, mid
                            )
                        )

        return {
            "status":        "ok",
            "tick":          self.tick,
            "time":          round(self.time, 2),
            "vehicle_count": len(self.vehicles),
            "intersections": len(self.road_network.intersections),
            "roads":         len(self.road_network.roads),
            "lanes":         len(self.road_network.lanes),
            "vehicles":      vehicle_list,
            "messages":      message_list
        }

    # ------------------------------------------------------------------ #
    # UTILITIES                                                          #
    # ------------------------------------------------------------------ #

    def get_vehicle_count(self):
        return len(self.vehicles)

    def get_emergency_vehicle_count(self):
        """
        Return the number of currently active emergency vehicles.

        Returns:
            int: Count of vehicles whose type is 'emergency'.
        """
        return sum(1 for v in self.vehicles if getattr(v, 'type', None) == 'emergency')

    def get_metrics(self):
        return {
            "total_vehicles_spawned": len(self.vehicles),
            "active_vehicles":        len(self.vehicles),
            "simulation_time":        self.time,
            "simulation_ticks":       self.tick
        }