# DeltaNet Server
#### `@deltanet/delta-net-server`

[![npm version](https://img.shields.io/npm/v/@deltanet/delta-net-server.svg?style=flat)](https://www.npmjs.com/package/@deltanet/delta-net-server)

This package contains the `DeltaNetServer` class that provides a way to accept websocket connections that can each set int64 components and byte states which are then visible to every other connected user.

The WebSocket protocol used by this package, `delta-net-v0.1`, is defined in `@deltanet/delta-net-protocol`.

A client for the `delta-net-v0.1` protocol is provided by `@deltanet/delta-net-web`.
