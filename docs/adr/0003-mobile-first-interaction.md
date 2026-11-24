# 0003. Mobile-first interaction model

- Status: Accepted
- Date: 2026-11-24

## Context

Existing node editors assume a mouse: hover states, right-click menus, precise 8 px ports and wheel zoom. On a phone those fail. Fingers are imprecise, the screen is narrow and tall, there is no hover, and long-presses and lifting fingers produce surprising synthetic events.

## Decision

Touch is the primary input. Mouse and keyboard are supported as equals, never as the only path.

- Pointer Events with `touch-action: none` on the canvas. One finger pans, two fingers pinch.
- Ports have 44 px hit areas, and each has its own listener so browser touch adjustment snaps to ports rather than nearby inputs.
- Two ways to connect: drag port to port, or **tap a port, then tap another port or a node**.
- Adding nodes:
  - Long-press the background, or press **+**.
  - With a node, port or wire selected, **+** adds a node wired to it, on the side it needs.
  - Dropping a wire on empty space adds a connected node.
- The add menu is a bottom sheet. Taps are ignored for 350 ms after it opens, so the lifting finger cannot pick an item.
- Placement is automatic (see 0005): new nodes go next to what they connect to and push neighbours aside, so people rarely need to drag precisely.
- Form fields use 16 px text so iOS does not zoom on focus. Rarely used params can be marked `advanced` and fold behind "More".

## Consequences

- One codebase works on phones, tablets and desktops.
- There is more interaction state to test. Each gesture is covered by browser checks with emulated touch devices.
- Hover-only affordances are not allowed anywhere in the editor.
