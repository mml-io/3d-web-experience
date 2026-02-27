# DeltaNet Server
#### `@mml-io/delta-net-server`

[![npm version](https://img.shields.io/npm/v/@mml-io/delta-net-server.svg?style=flat)](https://www.npmjs.com/package/@mml-io/delta-net-server)

This package contains the `DeltaNetServer` class that provides a way to accept websocket connections that can each set int64 components and byte states which are then visible to every other connected user.

The WebSocket protocols used by this package (`delta-net-v0.1` and `delta-net-v0.2`) are defined in `@mml-io/delta-net-protocol`. Protocol version negotiation is handled automatically via WebSocket subprotocols.

A client for the DeltaNet protocols is provided by `@mml-io/delta-net-web`.
