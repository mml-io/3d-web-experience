---
name: 3d-web-bridge
description: Connect to and interact with a 3D virtual world as an avatar. Use when the user asks to explore a 3D world, interact with objects in a scene, chat with other users in a virtual environment, or control an avatar in a multi-user experience. Also use when asked to start a bridge, connect to an experience server, or do anything involving MML scenes.
---

# 3D Web Experience Bridge

Control an avatar in a multi-user 3D world. Move around, click objects, chat with users, and react to world events in real-time.

## Setup

Start the bridge as a background command (it runs in the foreground by design):

```
Bash(run_in_background=true):
node packages/3d-web-experience-bridge/build/cli.js start \
  --server-url <EXPERIENCE_SERVER_URL> --port 3101 2>&1
```

Wait for `Experience Bridge ready` in the task output, then verify:

```bash
node packages/3d-web-experience-bridge/build/cli.js status --port 3101
```

All subsequent commands use `--port <PORT>`. Run any command with `--help` for its parameters.

## Commands

All commands return JSON. Add `--pretty-print` for readable output.

```
node packages/3d-web-experience-bridge/build/cli.js <command> --port <PORT> [options]
```

| Group | Commands | Notes |
|-------|----------|-------|
| **Movement** | `navigate_to`, `move_to`, `teleport`, `follow_user`, `stop_following`, `stop_moving`, `jump` | `navigate_to` uses pathfinding; `move_to` walks in a straight line |
| **Observation** | `get_scene_info`, `observe`, `search_nearby`, `get_element`, `find_placement_spots` | `observe` is the event loop — see below |
| **Interaction** | `click`, `interact` | `click` needs line of sight; `interact` needs proximity |
| **Communication** | `send_chat_message`, `get_chat_history` | Chat is visible to all users |
| **Avatar** | `set_animation_state`, `set_character_description` | Change appearance or animation |

## The observe event loop

`observe` blocks until a world event occurs (chat, user join/leave, scene change) or times out. It is the primary way to listen for events.

You are in a world with other people. If someone talks to you and you ignore them because you were busy clicking cubes, that's broken. The observe loop exists to keep you responsive.

### The core loop

Your session should alternate between **acting** and **observing**. After every 1-2 actions, run observe to check for events before continuing:

```
action → observe → react → action → observe → react → ...
```

Run observe as a **direct inline command** with a short timeout:

```bash
node packages/3d-web-experience-bridge/build/cli.js observe \
  --timeout-seconds 10 --resume-from last \
  --chat true --users true --arrival false --scene false \
  --port <PORT> 2>/dev/null
```

This blocks for up to 10 seconds waiting for events. If an event arrives sooner, it returns immediately. If nothing happens, it times out and you continue with your next action.

Always keep `--chat true` and `--users true` — you must always be listening for people talking to you. Only `--arrival` and `--scene` are worth toggling off, because they fire frequently and cause unnecessary wakeups.

### Reacting to events

When observe returns events, act on them before resuming your plan:

- **Chat message from a user** → Reply with `send_chat_message`. This is the highest priority. Not every message needs a response — ambient chatter between other users or messages clearly not addressed to you can be acknowledged and moved past. But if someone is talking to you, reply before doing anything else.
- **User joined** → Greet them if appropriate.
- **User left** → Stop following them if you were.
- **Scene changed** → Check what changed with `get_element` if relevant to your current task.

### Example session flow

```
1. navigate_to --x 10 --z 5          (start walking)
2. observe --timeout-seconds 10       (check for events while walking)
   → timeout, no events
3. status                             (check if arrived)
   → still moving
4. observe --timeout-seconds 10       (check again)
   → chat: User 3 says "Hey!"
5. send_chat_message "Hey User 3!"    (reply immediately)
6. observe --timeout-seconds 10       (listen for response)
   → timeout
7. status                             (check arrival)
   → arrived
8. search_nearby --radius 15          (explore the area)
9. observe --timeout-seconds 10       (check for events)
   → ...continue...
```

### Observe rules

| Rule | Why |
|------|-----|
| Run observe between actions | Every 1-2 actions, observe for events. Don't chain 5 actions without checking |
| Always pass `--resume-from last` | Continues from the previous cursor so you don't miss events between cycles |
| Never disable `--chat` | You will miss people talking to you. Chat events are small and infrequent — there is no reason to filter them |
| One observer at a time | Never run a second observe while one is active — they share an event stream |
| Use short timeouts (5-15s) | Long timeouts block you from acting. Short ones let you interleave actions and listening |
| Don't use observe to wait for navigation | Use the `status` command to check `isMoving` instead |
| Don't run observe inside subagent action chains | Keep observe in your main thread only |

### Checking arrival after navigation

After `navigate_to` or `follow_user`, use the status command to check if you've arrived:

```bash
node packages/3d-web-experience-bridge/build/cli.js status --port <PORT>
```

This returns small JSON with `isMoving`, `position`, etc. Do not use `curl`, `python3`, or `node -e` — use the CLI command.

## Running actions

All non-observe commands run as **direct inline commands** — not subagents, not background. They complete in 1-2 seconds.

```bash
CLI=packages/3d-web-experience-bridge/build/cli.js

# Pathfinding navigation (routes around obstacles, jumps between platforms)
node $CLI navigate_to --x 10 --y 0 --z 5 --speed 5 --port <PORT>

# Direct line movement (ignores obstacles)
node $CLI move_to --x 10 --y 0 --z 5 --speed 5 --port <PORT>

# Instant teleport
node $CLI teleport --x 10 --y 0 --z 5 --port <PORT>

# Follow a user until within 3 units
node $CLI follow_user --username "SomeUser" --stop-distance 3 --port <PORT>

# Scene overview: position, users, interactive elements
node $CLI get_scene_info --port <PORT>

# Check movement status / current position
node $CLI status --port <PORT>

# Find elements within 15 units
node $CLI search_nearby --radius 15 --port <PORT>

# Click an element by node ID (from get_scene_info)
node $CLI click --node-id 42 --port <PORT>

# Send a chat message
node $CLI send_chat_message --message "Hello!" --port <PORT>

# Read recent chat history
node $CLI get_chat_history --last-n 20 --port <PORT>
```

## Geometry summarization

`get_scene_info --include-geometry true` returns raw mesh data for every object in the world — thousands of tokens. **Never read this in your main context.** Delegate to a background subagent and have it return a concise spatial summary:

```
Agent(run_in_background=true): "Run the following command and return a concise summary
of major structures, their approximate positions/sizes, and open areas:

node packages/3d-web-experience-bridge/build/cli.js get_scene_info \
  --include-geometry true --port <PORT> --pretty-print 2>/dev/null"
```

## Discovery

Explore available commands and their parameters:

```bash
CLI=packages/3d-web-experience-bridge/build/cli.js

# List all commands
node $CLI help

# Show parameters for a specific command
node $CLI navigate_to --help
node $CLI observe --help
```

## Session workflow

1. **Start the bridge** and verify connection via `status` command
2. **Survey** — `get_scene_info` to see your position, users, and elements
3. **Act and observe** — alternate between actions and observe calls. Every 1-2 actions, run observe to check for events
4. **React** — when observe returns a chat message or user event, respond before resuming your plan
5. **Stay responsive** — your exploration plan is never more important than responding to people who are talking to you. But use judgement — not every message requires a response
