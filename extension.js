import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as Keyboard from 'resource:///org/gnome/shell/ui/status/keyboard.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const INDICATOR_CONTAINER_NAME = 'paperwm-extra-indicators';

export default class PaperWmExtraIndicators extends Extension {
    enable() {
        this._spaces = [];
        this._checkTimer = null;
        this._childAddedId = null;
        this._container = null;

        // Use a slight delay to ensure PaperWM is loaded
        this._checkTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._startLooking();
            this._checkTimer = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    disable() {
        if (this._checkTimer) {
            GLib.source_remove(this._checkTimer);
            this._checkTimer = null;
        }

        this._removeIndicators();
        this._spaces = [];
    }

    _startLooking() {
        const bgGroup = Main.layoutManager._backgroundGroup;
        if (!bgGroup) return;

        // PaperWM creates a container named 'spaceContainer'
        // We look for it in _backgroundGroup
        const container = bgGroup.get_children().find(c => c.name === 'spaceContainer');
        if (container) {
            this._connectToContainer(container);
        } else {
            // Keep looking if not found yet (e.g. if PaperWM loads slowly)
            this._checkTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
                this._startLooking();
                this._checkTimer = null;
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _connectToContainer(container) {
        this._container = container;
        
        // Listen for new spaces (PaperWM adds spaces as children to spaceContainer)
        this._childAddedId = container.connect('child-added', (c, actor) => {
            this._processSpace(actor);
        });
        
        // Process existing spaces
        container.get_children().forEach(s => this._processSpace(s));
    }

    _processSpace(clipActor) {
        if (clipActor._hasExtraIndicators) return;
        
        if (!clipActor.has_allocation()) {
            const id = clipActor.connect('notify::allocation', () => {
                clipActor.disconnect(id);
                this._processSpace(clipActor);
            });
            return;
        }

        clipActor._hasExtraIndicators = true;

        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (!clipActor.get_parent()) return GLib.SOURCE_REMOVE;

            const [x, y] = clipActor.get_transformed_position();
            
            if (Number.isNaN(x) || Number.isNaN(y)) {
                clipActor._hasExtraIndicators = false; 
                return GLib.SOURCE_REMOVE;
            }

            const monitor = Main.layoutManager.findMonitorForActor(clipActor);
            const primaryMonitor = Main.layoutManager.primaryMonitor;
            const primaryIndex = Main.layoutManager.primaryIndex;
            
            let currentMonitorIndex = -1;
            if (typeof monitor === 'number') {
                currentMonitorIndex = monitor;
            } else if (monitor && typeof monitor.index === 'number') {
                currentMonitorIndex = monitor.index;
            }

            let isPrimary = false;
            if (monitor === primaryMonitor) isPrimary = true;
            if (currentMonitorIndex === primaryIndex) isPrimary = true;
            if (x >= primaryMonitor.x && x < primaryMonitor.x + primaryMonitor.width &&
                y >= primaryMonitor.y && y < primaryMonitor.y + primaryMonitor.height) {
                isPrimary = true;
            }

            if (isPrimary) {
                return GLib.SOURCE_REMOVE;
            }

            // Create container
            const box = new St.BoxLayout({
                name: INDICATOR_CONTAINER_NAME,
                reactive: true,
                x_expand: false,
                y_expand: false,
                x_align: Clutter.ActorAlign.END,
                y_align: Clutter.ActorAlign.FILL, 
                height: Main.panel.height
            });

            // Styling: minimal padding, explicit height context
            box.set_style('background-color: rgba(0,0,0,0.9); border-radius: 0 0 0 12px; padding: 0px; margin: 0px;');

            // Helper to add child with explicit sizing
            const safeAdd = (child, name) => {
                try {
                    // FORCE size to match panel
                    child.y_expand = false; 
                    child.y_align = Clutter.ActorAlign.CENTER; 
                    
                    // Set height to panel height to prevent squashing
                    child.set_height(Main.panel.height);
                    child.set_width(-1); // Natural width
                    
                    box.add_child(child);
                } catch (e) {
                    console.error(`PaperWM Extra Indicators: Failed to add ${name}`, e);
                }
            };

            // 1. Input Source
            try {
                const inputIndicator = new Keyboard.InputSourceIndicator();
                if (inputIndicator) safeAdd(inputIndicator, 'InputSourceIndicator');
            } catch (e) {
                console.error('PaperWM Extra Indicators: Failed to create InputSourceIndicator', e);
            }

            // 2. System Indicators
            try {
                const quickSettings = Main.panel.statusArea.quickSettings;
                if (quickSettings) {
                    const indicatorsActor = quickSettings.get_first_child(); 
                    if (indicatorsActor) {
                         const clone = new Clutter.Clone({ source: indicatorsActor });
                         clone.reactive = true;
                         safeAdd(clone, 'QuickSettingsClone');
                    }
                }
            } catch (e) {
                 console.error('PaperWM Extra Indicators: Failed to clone SystemIndicators', e);
            }

            // 3. Ubuntu AppIndicators
            try {
                const keys = Object.keys(Main.panel.statusArea);
                const appIndKey = keys.find(k => k.toLowerCase().includes('appindicator'));
                if (appIndKey) {
                    const appInd = Main.panel.statusArea[appIndKey];
                    let sourceActor = null;
                    if (appInd instanceof Clutter.Actor) sourceActor = appInd;
                    else if (appInd.container) sourceActor = appInd.container;
                    else if (appInd.actor) sourceActor = appInd.actor;
                    else if (appInd.get_first_child) sourceActor = appInd;

                    if (sourceActor) {
                         const clone = new Clutter.Clone({ source: sourceActor });
                         safeAdd(clone, 'AppIndicatorsClone');
                    }
                }
            } catch(e) {
                console.error('PaperWM Extra Indicators: Failed to clone AppIndicators', e);
            }

            // Add box to PaperWM clip actor
            try {
                clipActor.add_child(box);
                
                // Position: Top Right
                const constraintX = new Clutter.AlignConstraint({
                    source: clipActor,
                    align_axis: Clutter.AlignAxis.X_AXIS,
                    factor: 1.0 // Right
                });
                
                box.set_y(0);
                box.add_constraint(constraintX);
                box.set_height(Main.panel.height);
                
                clipActor.set_child_above_sibling(box, null);
            } catch(e) {
                console.error('PaperWM Extra Indicators: Failed to attach box to clipActor', e);
            }

            return GLib.SOURCE_REMOVE;
        });
    }

    _removeIndicators() {
        if (this._container && this._childAddedId) {
            this._container.disconnect(this._childAddedId);
            this._childAddedId = null;
        }

        this._spaces.forEach(space => {
            const box = space.get_children().find(c => c.name === INDICATOR_CONTAINER_NAME);
            if (box) box.destroy();
            delete space._hasExtraIndicators;
        });
    }
}
