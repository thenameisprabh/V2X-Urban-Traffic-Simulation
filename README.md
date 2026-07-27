# V2X Rendering System

## Purpose

This directory contains the complete frontend rendering layer for the
V2X Intelligent Traffic Simulation Platform.

The rendering system is a **pure consumer** of backend simulation data.
It never modifies simulation state. It has no knowledge of the simulation
engine. It communicates with the backend only through the existing API
contracts defined in the FastAPI layer.

---

## Coordinate System

The backend uses a **local Cartesian simulation space** measured in metres.

- X axis: positive direction → East (right on screen)
- Z axis: positive direction → South (down on screen)
- Origin: implicit, defined by `metadata.bounds` in the road network

This is NOT geographic (lat/lon). The `metadata.crs` field in
`keskustori.json` previously said "EPSG:4326" — this was a documentation
error and has been corrected to "local_sim_metres".

`SimProjector` maps simulation [x, z] coordinates to canvas [x, y] pixels
using a linear scale. No Mercator projection. No geographic math.

---

## Directory Structure

