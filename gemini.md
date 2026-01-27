# Project Context

This project is a GNOME Shell Extension (`paperwm-extra-bar-indicators`) that sits on top of the **PaperWM** extension.

## Core Functionality
- It listens for the creation of PaperWM "spaces" (workspaces) via the `spaceContainer` in the `_backgroundGroup`.
- It identifies if a space is on a secondary monitor (non-primary).
- It injects a container (`St.BoxLayout`) into the PaperWM clip actor.
- It populates this container with clones of:
  - `Main.panel.statusArea.quickSettings`
  - `Keyboard.InputSourceIndicator`
  - Ubuntu AppIndicators (if present in `Main.panel.statusArea`).

## Technical Constraints & Patterns
- **Layout:** We explicitly set the container height to `Main.panel.height` to prevent squashing/stretching issues common with `Clutter.Clone`.
- **Styling:** We avoid complex CSS classes that might conflict with the main panel, relying instead on manual alignment (`Clutter.ActorAlign.CENTER`) and minimal styling (`padding: 0`).
- **Timing:** We use `notify::allocation` signals to ensure the PaperWM actors have valid geometry before checking monitor positions.

## Commit Conventions
- **Strict Conventional Commits:** You must strictly follow the Conventional Commits specification.
- **Lowercase Headers:** The subject of the commit message must **NOT** start with a capital letter.
  - **Good:** `feat: add monitor detection logic`
  - **Bad:** `feat: Add monitor detection logic`
  - **Bad:** `Added monitor detection`
- **Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `chore`.
