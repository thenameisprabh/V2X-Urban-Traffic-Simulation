/**
 * render-constants.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for all visual configuration in the rendering system.
 *
 * DESIGN INTENT
 * ─────────────
 * Every colour, width threshold, and visual parameter is defined here.
 * No renderer hardcodes a colour or dimension inline.
 * To change the visual appearance of any element, only this file changes.
 *
 * ROAD TYPE KEYS
 * ──────────────
 * Road types are simulation-native strings inferred by roadNetworkAdapter():
 *   'major'     — high-capacity arterial (50km/h, 4+ lanes)
 *   'arterial'  — standard urban road    (50km/h, 2 lanes)
 *   'collector' — collector/distributor  (40km/h)
 *   'local'     — local residential      (30km/h)
 *   'service'   — service roads, alleys  (slow)
 *   'path'      — pedestrian/cycle paths
 *
 * These are NOT OSM types. The adapter translates backend data → these types.
 * The renderer reads these types. No OSM string appears anywhere in rendering.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

// ─── Road Visual Configuration ────────────────────────────────────────────────

/**
 * Visual parameters per simulation road type.
 *
 * @type {Object.<string, {
 *   surfaceColour: string,
 *   casingColour:  string,
 *   shadowColour:  string,
 *   markingColour: string,
 *   centreColour:  string,
 *   casingWidthM:  number,
 *   shadowWidthM:  number,
 *   drawCasing:    boolean,
 *   drawMarkings:  boolean,
 *   drawShadow:    boolean,
 *   drawCentreLine:boolean,
 *   zOrder:        number
 * }>}
 */
const ROAD_STYLE = {
  major: {
    surfaceColour:   '#2c2c3a',
    casingColour:    '#1a1a28',
    shadowColour:    'rgba(0,0,0,0.55)',
    markingColour:   'rgba(255,255,255,0.80)',
    centreColour:    'rgba(255,220,60,0.85)',
    casingWidthM:    0.5,   // metres added each side beyond road surface
    shadowWidthM:    1.2,   // metres added each side for the shadow pass
    drawCasing:      true,
    drawMarkings:    true,
    drawShadow:      true,
    drawCentreLine:  true,
    zOrder:          40,
  },
  arterial: {
    surfaceColour:   '#262634',
    casingColour:    '#18182a',
    shadowColour:    'rgba(0,0,0,0.45)',
    markingColour:   'rgba(255,255,255,0.65)',
    centreColour:    'rgba(255,220,60,0.70)',
    casingWidthM:    0.4,
    shadowWidthM:    1.0,
    drawCasing:      true,
    drawMarkings:    true,
    drawShadow:      true,
    drawCentreLine:  true,
    zOrder:          35,
  },
  collector: {
    surfaceColour:   '#222232',
    casingColour:    '#16162a',
    shadowColour:    'rgba(0,0,0,0.38)',
    markingColour:   'rgba(255,255,255,0.50)',
    centreColour:    'rgba(255,220,60,0.55)',
    casingWidthM:    0.3,
    shadowWidthM:    0.8,
    drawCasing:      true,
    drawMarkings:    true,
    drawShadow:      false,
    drawCentreLine:  true,
    zOrder:          30,
  },
  local: {
    surfaceColour:   '#1e1e2e',
    casingColour:    '#14142a',
    shadowColour:    'rgba(0,0,0,0.30)',
    markingColour:   'rgba(255,255,255,0.35)',
    centreColour:    'rgba(255,220,60,0.40)',
    casingWidthM:    0.2,
    shadowWidthM:    0.5,
    drawCasing:      true,
    drawMarkings:    false,
    drawShadow:      false,
    drawCentreLine:  false,
    zOrder:          20,
  },
  service: {
    surfaceColour:   '#1a1a28',
    casingColour:    '#111122',
    shadowColour:    'rgba(0,0,0,0.20)',
    markingColour:   'rgba(200,200,200,0.25)',
    centreColour:    'rgba(200,200,200,0.25)',
    casingWidthM:    0.1,
    shadowWidthM:    0.3,
    drawCasing:      false,
    drawMarkings:    false,
    drawShadow:      false,
    drawCentreLine:  false,
    zOrder:          10,
  },
  path: {
    surfaceColour:   '#1a2a1a',
    casingColour:    '#142014',
    shadowColour:    'rgba(0,0,0,0.15)',
    markingColour:   'rgba(140,200,140,0.30)',
    centreColour:    'rgba(140,200,140,0.30)',
    casingWidthM:    0.1,
    shadowWidthM:    0.2,
    drawCasing:      false,
    drawMarkings:    false,
    drawShadow:      false,
    drawCentreLine:  false,
    zOrder:          5,
  },
};

// ─── Vehicle Visual Configuration ────────────────────────────────────────────

/**
 * Physical dimensions and colours per vehicle type.
 * Dimensions are in simulation metres (same coordinate space as the network).
 *
 * @type {Object.<string, {
 *   colour:         string,
 *   emergencyColour:string,
 *   widthM:         number,
 *   lengthM:        number,
 *   wheelbaseRatio: number,
 *   zOrder:         number
 * }>}
 */
const VEHICLE_STYLE = {
  car: {
    colour:          '#4a90d9',
    emergencyColour: '#ff3b30',
    widthM:          2.0,
    lengthM:         4.5,
    wheelbaseRatio:  0.6,
    zOrder:          60,
  },
  bus: {
    colour:          '#ffd60a',
    emergencyColour: '#ffd60a',
    widthM:          2.55,
    lengthM:         12.0,
    wheelbaseRatio:  0.75,
    zOrder:          58,
  },
  truck: {
    colour:          '#bf5af2',
    emergencyColour: '#bf5af2',
    widthM:          2.5,
    lengthM:         8.0,
    wheelbaseRatio:  0.65,
    zOrder:          57,
  },
  cyclist: {
    colour:          '#34c759',
    emergencyColour: '#34c759',
    widthM:          0.8,
    lengthM:         1.8,
    wheelbaseRatio:  0.6,
    zOrder:          55,
  },
  pedestrian: {
    colour:          '#ff9f0a',
    emergencyColour: '#ff9f0a',
    widthM:          0.5,
    lengthM:         0.5,
    wheelbaseRatio:  0.0,
    zOrder:          54,
  },
  motorcycle: {
    colour:          '#30d158',
    emergencyColour: '#30d158',
    widthM:          0.9,
    lengthM:         2.2,
    wheelbaseRatio:  0.6,
    zOrder:          56,
  },
  parked: {
    colour:          '#636366',
    emergencyColour: '#636366',
    widthM:          2.0,
    lengthM:         4.5,
    wheelbaseRatio:  0.6,
    zOrder:          45,
  },

  // ── Phase 11: Emergency vehicle ──────────────────────────────────────────
  // Type string matches what SimulationEngine sets: v['type'] = 'emergency'.
  // colour          — vivid red body, unambiguous at any zoom level.
  // emergencyColour — same red used by the pulsing glow in _drawEmergencyGlow.
  // widthM/lengthM  — slightly larger than a car: visually dominant on road.
  // wheelbaseRatio  — non-zero: drawn as a rectangle, not a circle.
  // zOrder: 70      — highest of all types: always renders on top.
  // ─────────────────────────────────────────────────────────────────────────
  emergency: {
    colour:          '#ff3b30',   // vivid red body
    emergencyColour: '#ff3b30',   // glow matches body
    widthM:          2.3,         // slightly wider than a car (2.0 m)
    lengthM:         5.2,         // slightly longer than a car (4.5 m)
    wheelbaseRatio:  0.62,
    zOrder:          70,          // above all other vehicle types
  },
  // ── end Phase 11 ─────────────────────────────────────────────────────────

  // Fallback for unknown types from backend
  default: {
    colour:          '#48484a',
    emergencyColour: '#ff3b30',
    widthM:          2.0,
    lengthM:         4.5,
    wheelbaseRatio:  0.6,
    zOrder:          50,
  },
};

// ─── Traffic Signal Configuration ────────────────────────────────────────────

/**
 * Visual parameters for traffic signal rendering.
 * Phase names match the normalised backend state strings.
 */
const SIGNAL_STYLE = {
  housingColour:    '#1a1a22',
  housingStroke:    '#2e2e3c',
  housingPadding:   0.15,   // fraction of light radius
  glowMultiplier:   3.0,    // shadowBlur = lightRadius * this

  phases: {
    GREEN:  {
      activeColour:  '#32d74b',
      glowColour:    '#32d74b',
      inactiveColour:'#0a2a12',
    },
    YELLOW: {
      activeColour:  '#ffd60a',
      glowColour:    '#ffd60a',
      inactiveColour:'#3a2e00',
    },
    RED:    {
      activeColour:  '#ff453a',
      glowColour:    '#ff453a',
      inactiveColour:'#3a1010',
    },
  },

  defaultState: 'RED',
};

// ─── Sidewalk Configuration ───────────────────────────────────────────────────

const SIDEWALK_STYLE = {
  colour:       'rgba(160,160,180,0.22)',
  strokeColour: 'rgba(160,160,180,0.08)',
  minWidthPx:   1.0,   // do not draw if projected width is below this
};

// ─── Crosswalk Configuration ──────────────────────────────────────────────────

const CROSSWALK_STYLE = {
  stripeColour:     'rgba(255,255,255,0.62)',
  stripeWidthM:     0.45,   // physical stripe width in metres
  stripeGapM:       0.45,   // physical gap between stripes
  crosswalkWidthFr: 0.85,   // crosswalk width as fraction of road carriageway
  minStripes:       3,
};

// ─── Terrain Configuration ────────────────────────────────────────────────────

const TERRAIN_STYLE = {
  gradientStops: [
    { pos: 0.0, colour: '#141422' },
    { pos: 0.5, colour: '#111120' },
    { pos: 1.0, colour: '#0e0e1c' },
  ],
  noiseColour:  '#1e1e30',
  noiseAlpha:   0.018,
  noiseCellPx:  4,     // pixel cell size for the noise dot pattern
  noiseDensity: 0.45,  // fraction of cells that get a dot
};

// ─── Vignette Configuration ───────────────────────────────────────────────────

const VIGNETTE_STYLE = {
  stops: [
    { pos: 0.00, colour: 'rgba(0,0,0,0)'    },
    { pos: 0.55, colour: 'rgba(0,0,0,0)'    },
    { pos: 0.80, colour: 'rgba(0,0,0,0.08)' },
    { pos: 1.00, colour: 'rgba(0,0,0,0.50)' },
  ],
};

// ─── Building Configuration ───────────────────────────────────────────────────

const BUILDING_STYLE = {
  default: {
    wallColour:    '#1e1e2c',
    roofColour:    '#2a2a3a',
    outlineColour: '#14141e',
    shadowColour:  'rgba(0,0,0,0.40)',
  },
  commercial: {
    wallColour:    '#1a2030',
    roofColour:    '#222840',
    outlineColour: '#10101e',
    shadowColour:  'rgba(0,0,0,0.45)',
  },
  residential: {
    wallColour:    '#201e28',
    roofColour:    '#282634',
    outlineColour: '#141220',
    shadowColour:  'rgba(0,0,0,0.38)',
  },
  industrial: {
    wallColour:    '#1c1c22',
    roofColour:    '#242428',
    outlineColour: '#101010',
    shadowColour:  'rgba(0,0,0,0.50)',
  },
};

// ─── Vegetation Configuration ─────────────────────────────────────────────────

const VEGETATION_STYLE = {
  parkFill:        'rgba(20,35,20,0.70)',
  parkStroke:      'rgba(30,55,30,0.40)',
  treeCanopy:      '#1a3a1a',
  treeHighlight:   '#224422',
  treeShadow:      'rgba(0,0,0,0.35)',
  treeShadowBlur:  4,
  proceduralSpacingM: 8.0,
  maxProceduralTrees: 200,
};

// ─── Water Configuration ──────────────────────────────────────────────────────

const WATER_STYLE = {
  deepColour:    '#0a0f1e',
  shallowColour: '#121a2e',
  shoreColour:   'rgba(30,50,80,0.60)',
  shimmerColour: 'rgba(100,150,220,0.12)',
  shimmerSpeed:  0.03,   // animOffset increment per millisecond
  riverWidthM:   15.0,
  streamWidthM:  5.0,
};

// ─── Zoom Thresholds ──────────────────────────────────────────────────────────
// Feature visibility is controlled by zoom level.
// Each value is the minimum zoom at which that feature becomes visible.

const ZOOM_THRESHOLDS = {
  sidewalks:       1.0,
  laneMarkings:    1.5,
  crosswalks:      1.2,
  turnArrows:      2.0,
  trafficSignals:  0.8,
  vehicleLabels:   3.5,
  buildingDetail:  1.2,
  treeDetail:      1.5,
};

// ── Global registration ───────────────────────────────────────────────────────
window.RENDER_CONSTANTS = {
    ROAD_STYLE,
    VEHICLE_STYLE,
    SIGNAL_STYLE,
    SIDEWALK_STYLE,
    CROSSWALK_STYLE,
    TERRAIN_STYLE,
    VIGNETTE_STYLE,
    BUILDING_STYLE,
    VEGETATION_STYLE,
    WATER_STYLE,
    ZOOM_THRESHOLDS,
};
// Export individual constants to window for cross-module access
window.ROAD_STYLE      = RENDER_CONSTANTS.ROAD_STYLE;
window.VEHICLE_STYLE   = RENDER_CONSTANTS.VEHICLE_STYLE;
window.SIGNAL_STYLE    = RENDER_CONSTANTS.SIGNAL_STYLE;
window.SIDEWALK_STYLE  = RENDER_CONSTANTS.SIDEWALK_STYLE;
window.CROSSWALK_STYLE = RENDER_CONSTANTS.CROSSWALK_STYLE;
