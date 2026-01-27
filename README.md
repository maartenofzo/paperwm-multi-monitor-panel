# PaperWM Multi-Monitor Panel

This is a GNOME Shell extension designed to enhance the [PaperWM](https://github.com/paperwm/PaperWM) tiling window manager experience on multi-monitor setups.

By default, PaperWM provides per-monitor workspaces/bars, but the system status indicators (Quick Settings, Clock, Input Source, AppIndicators) are only visible on the primary monitor's top panel. This extension replicates those indicators onto the PaperWM bars of your secondary monitors, maintaining visual consistency and providing full interactivity.

## Terminology

- **PaperWM Bar:** The top strip provided by PaperWM on every monitor for workspace management.
- **GNOME Shell Panel:** The system-wide top bar (usually only on the primary monitor) that houses the clock and system indicators.

This extension bridges the two by bringing **Panel** functionality into the **PaperWM Bar** on all monitors.

## Features

- **Multi-Monitor Support:** Automatically detects secondary monitors and adds indicators to the PaperWM bar.
- **Smart Detection:** Skips the primary monitor to prevent duplicate indicators.
- **Full Interactivity:**
  - **Quick Settings:** Click the Wifi/Volume/Battery icons on any monitor to open the Quick Settings menu right there.
  - **Date & Time:** Click the clock to open the Notification/Calendar panel on that monitor.
  - **Input Source:** Click the keyboard icon to switch layouts (if available).
- **System Integration:**
  - Mirrors **Quick Settings** (Wifi, Volume, Battery, etc.).
  - Mirrors **Date/Time** (Clock).
  - Mirrors **Input Source** (Keyboard layout).
  - Mirrors **Ubuntu AppIndicators** (Tray icons), if available.
- **Native Look & Feel:**
  - Uses standard GNOME Shell hover states (`.panel-button`).
  - Correctly sizes icons to match the panel height without squashing.
  - Aligns indicators to the right, matching the standard shell layout order (AppIndicators -> Clock -> Input -> System).

## Requirements

- GNOME Shell 46/47
- [PaperWM](https://github.com/paperwm/PaperWM) extension installed and enabled.
- (Optional) AppIndicator/KStatusNotifierItem support for tray icons.

## Installation

### Manual Installation

1. Clone this repository.
2. Zip the extension:
   ```bash
   zip -r extension.zip . -x "*.git*" "extension.zip"
   ```
3. Install the extension using the CLI:
   ```bash
   gnome-extensions install --force extension.zip
   ```
4. Enable the extension:
   ```bash
   gnome-extensions enable paperwm-extra-bar-indicators@maarten.me
   ```
5. Restart GNOME Shell (Log out/in or `Alt+F2`, `r` on X11) if needed.

## Development

The core logic resides in `extension.js`. It listens for PaperWM space creation and appends a `St.BoxLayout` containing interactive `St.Button`s wrapping `Clutter.Clone`s of the main panel's status area actors. It leverages GNOME Shell's existing menus by temporarily "hijacking" their source actor to open them on the secondary monitor.