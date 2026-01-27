# PaperWM Extra Bar Indicators

This is a GNOME Shell extension designed to enhance the [PaperWM](https://github.com/paperwm/PaperWM) tiling window manager experience on multi-monitor setups.

By default, PaperWM provides per-monitor workspaces/bars, but the system status indicators (Quick Settings, Network, Volume, Battery, Input Source, AppIndicators) are only visible on the primary monitor's top panel. This extension replicates those indicators onto the PaperWM bars of your secondary monitors.

## Features

- **Multi-Monitor Support:** Automatically detects secondary monitors and adds indicators to the PaperWM bar.
- **Smart Detection:** Skips the primary monitor to prevent duplicate indicators.
- **System Integration:**
  - Mirrors **Quick Settings** (Wifi, Volume, Battery, etc.).
  - Mirrors **Input Source** (Keyboard layout).
  - Mirrors **Ubuntu AppIndicators** (Tray icons), if available.
- **Visual Consistency:** Matches the system panel height and styling to look integrated with GNOME Shell.

## Requirements

- GNOME Shell 46/47
- [PaperWM](https://github.com/paperwm/PaperWM) extension installed and enabled.
- (Optional) AppIndicator/KStatusNotifierItem support for tray icons.

## Installation

### From Source

1. Clone this repository or download the source.
2. Run the installation command:
   ```bash
   # Create the extension directory
   mkdir -p ~/.local/share/gnome-shell/extensions/paperwm-extra-bar-indicators@maarten.me
   
   # Copy files
   cp extension.js metadata.json ~/.local/share/gnome-shell/extensions/paperwm-extra-bar-indicators@maarten.me/
   ```
3. Restart GNOME Shell (Log out/in or `Alt+F2`, `r` on X11).
4. Enable the extension:
   ```bash
   gnome-extensions enable paperwm-extra-bar-indicators@maarten.me
   ```

## Development

The core logic resides in `extension.js`. It listens for PaperWM space creation and appends a `St.BoxLayout` containing `Clutter.Clone`s of the main panel's status area actors.
