<img src="./src/assets/crease.svg" width="48" height="48" alt="Crease" />

# Crease

Visual feedback for FoldKit. Inspect elements, leave notes, and share context with your coding agent through MCP or copied Markdown and JSON.

Crease helps you show an agent exactly which part of an interface needs to change. You can inspect layout, spacing, typography, and colors; attach notes to elements; and review the context before sharing it. Registered controls can also include source locations, event Messages, and application state you choose to expose.

Crease currently runs from this checkout as a local development prototype. There is no published npm package or browser extension.

## Try it locally

Use Node 26 and npm. If you use nvm, run `nvm use` from the repository root to select the version in `.nvmrc`.

From your checkout, run:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:4173`. You should see the homepage, a floating toolbar, and a counter playground. Keep the server running while you use Crease or its MCP connection. It accepts local connections only.

## Leave your first note

1. The toolbar starts in inspection mode. Click the Crease icon to turn it off, then try the counter's **+**, **−**, and **Reset** controls.
2. Turn Crease back on and click a control to inspect it. Use `Alt+Shift+C` as a shortcut for the toggle.
3. Choose **Add a note**, describe the change you want, and choose **Add note** or press `Cmd/Ctrl+Enter` to save it.
4. Open **Feedback**. Review your notes in **Markdown** or **JSON**, then choose **Copy for agent** and paste the output into your coding agent or a message to a teammate.

See [Inspect an interface and leave feedback](docs/USAGE.md) for measuring spacing, inspecting typography and colors, editing notes, and keyboard shortcuts.

## Connect your coding agent

Crease's MCP server lets your agent read a snapshot of your selected element and notes. Nothing is available until you choose **Share snapshot** in Feedback. Share again to refresh the snapshot, or choose **Stop sharing** to prevent further reads.

Follow [Connect a coding agent](docs/MCP.md) for the client configuration, available tools, and troubleshooting. You can keep using copied feedback without connecting an agent.

## Know what you are sharing

Notes stay in your browser until you copy or share them. Application state and update history are opt-in and include only developer-registered fields; Crease never saves those values in annotation storage.

Shared snapshots expire after 15 minutes and disappear when the development server restarts. Agents have read-only access through Crease. Stopping sharing does not erase information an agent has already read.

Review context before sharing it, especially on pages containing private information. See [sharing and privacy](docs/MCP.md#sharing-and-privacy) for the safeguards and their limits.

## Current limits

- Source and application-state context require explicit registrations. The demo registers its counter; Crease does not automatically discover source ownership or trace which element caused a Command.
- Agent sharing works only with the local development server. It is not available through remote tunnels or production previews.
- Crease does not yet offer drawing tools, screenshot capture, cloud or team synchronization, or agent-driven changes to annotations.

## Work on Crease

Use the [contributor guide](docs/CONTRIBUTING.md) to find the relevant code, register FoldKit context, and run checks. Follow the [design guide](docs/DESIGN.md) for interface conventions.

The Crease mark and implementation are original; the visual design takes inspiration from [Mesurer](https://mesurer.dev/). Inter ships with its [font license](public/fonts/LICENSE-Inter.txt).
