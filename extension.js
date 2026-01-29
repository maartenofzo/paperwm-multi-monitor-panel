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
        this._spaceSignals = new Map(); // Map<spaceActor, list of signal IDs>
        this._checkTimer = null;
        this._childAddedId = null;
        this._monitorsChangedId = null;
        this._container = null;

        // Use a slight delay to ensure PaperWM is loaded
        this._checkTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._startLooking();
            this._checkTimer = null;
            return GLib.SOURCE_REMOVE;
        });

        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
            // Rebuild everything on monitor configuration changes to fix scaling/stretching
            this._rebuildAll();
        });
    }

    disable() {
        if (this._checkTimer) {
            GLib.source_remove(this._checkTimer);
            this._checkTimer = null;
        }

        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = null;
        }

        if (this._container && this._childAddedId) {
            this._container.disconnect(this._childAddedId);
            this._childAddedId = null;
        }

        this._spaces.forEach(space => this._cleanupSpace(space));
        this._spaces = [];
        this._spaceSignals.clear();
        this._container = null;
    }

    _startLooking() {
        const bgGroup = Main.layoutManager._backgroundGroup;
        if (!bgGroup) return;

        // PaperWM creates a container named 'spaceContainer'
        const container = bgGroup.get_children().find(c => c.name === 'spaceContainer');
        if (container) {
            this._connectToContainer(container);
        } else {
            // Keep looking if not found yet
            this._checkTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
                this._startLooking();
                this._checkTimer = null;
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _connectToContainer(container) {
        this._container = container;
        
        // Listen for new spaces
        this._childAddedId = container.connect('child-added', (c, actor) => {
            this._trackSpace(actor);
        });
        
        // Process existing spaces
        container.get_children().forEach(s => this._trackSpace(s));
    }

    _trackSpace(space) {
        if (this._spaces.includes(space)) return;

        this._spaces.push(space);
        
        // Listen for allocation changes (movement between monitors)
        // Debouncing might be good, but for now we just check cheaply.
        const allocId = space.connect('notify::allocation', () => {
             this._updateSpace(space);
        });

        // Listen for destruction
        const destroyId = space.connect('destroy', () => {
            this._cleanupSpace(space);
            const index = this._spaces.indexOf(space);
            if (index > -1) this._spaces.splice(index, 1);
        });

        this._spaceSignals.set(space, [allocId, destroyId]);

        // Initial update
        this._updateSpace(space);
    }

    _cleanupSpace(space) {
        // Remove indicators
        const box = space.get_children().find(c => c.name === INDICATOR_CONTAINER_NAME);
        if (box) box.destroy();
        delete space._hasExtraIndicators;

        // Disconnect signals
        const signals = this._spaceSignals.get(space);
        if (signals) {
            signals.forEach(id => space.disconnect(id));
            this._spaceSignals.delete(space);
        }
    }

    _rebuildAll() {
        this._spaces.forEach(space => {
            // Force remove existing indicators
            const box = space.get_children().find(c => c.name === INDICATOR_CONTAINER_NAME);
            if (box) box.destroy();
            delete space._hasExtraIndicators;
            
            // Re-evaluate
            this._updateSpace(space);
        });
    }

    _updateSpace(space) {
        if (!space.get_parent()) return;

        // Check if we are on primary monitor
        const isPrimary = this._isSpaceOnPrimary(space);

        const existingBox = space.get_children().find(c => c.name === INDICATOR_CONTAINER_NAME);

        if (isPrimary) {
            if (existingBox) {
                existingBox.destroy();
                delete space._hasExtraIndicators;
            }
        } else {
            if (!existingBox && !space._hasExtraIndicators) {
                // Ensure we have an allocation before creating
                if (!space.has_allocation()) return;
                
                // Double check position to be sure (allocation might be 0,0 if not mapped yet)
                const [x, y] = space.get_transformed_position();
                if (Number.isNaN(x) || Number.isNaN(y)) return;

                this._createIndicators(space);
            }
        }
    }

    _isSpaceOnPrimary(space) {
        const [x, y] = space.get_transformed_position();
        
        if (Number.isNaN(x) || Number.isNaN(y)) return true; // Safety default

        const primaryMonitor = Main.layoutManager.primaryMonitor;
        
        // Coordinate check
        if (x >= primaryMonitor.x && x < primaryMonitor.x + primaryMonitor.width &&
            y >= primaryMonitor.y && y < primaryMonitor.y + primaryMonitor.height) {
            return true;
        }
        
        // Monitor index check fallback
        const monitor = Main.layoutManager.findMonitorForActor(space);
        if (monitor && monitor === primaryMonitor) return true;
        
        return false;
    }

    _createIndicators(clipActor) {
        clipActor._hasExtraIndicators = true;

        const box = new St.BoxLayout({
            name: INDICATOR_CONTAINER_NAME,
            reactive: true,
            x_expand: false,
            y_expand: false,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.FILL, 
            height: Main.panel.height
        });

        box.add_style_class_name('panel');
        box.set_style('background-color: rgba(0,0,0,0.6); border-radius: 0 0 0 12px; padding: 0px; margin: 0px;');

        const createButton = (sourceActor, menu, name) => {
            try {
                // Ghost check 1: Source must be visible
                if (!sourceActor.visible) return null;

                const button = new St.Button({
                    style_class: 'panel-button',
                    reactive: true,
                    can_focus: true,
                    track_hover: true,
                    y_align: Clutter.ActorAlign.CENTER,
                    height: Main.panel.height
                });
                
                button.set_style('padding: 0px 8px; margin: 0px;');

                const clone = new Clutter.Clone({ source: sourceActor });
                clone.set_height(Main.panel.height);
                clone.set_width(-1); 
                clone.y_expand = false;
                clone.y_align = Clutter.ActorAlign.CENTER;
                clone.reactive = false; 
                clone.visible = true;
                
                button.set_child(clone);

                // Sync visibility: If source hides, button hides
                sourceActor.bind_property('visible', button, 'visible', GObject.BindingFlags.SYNC_CREATE);

                if (menu) {
                    button.connect('clicked', () => {
                         const originalSource = menu.sourceActor;
                         menu.sourceActor = button;
                         
                         button.add_style_pseudo_class('active');
                         button.add_style_pseudo_class('checked');
                         
                         menu.toggle();
                         
                         const id = menu.connect('open-state-changed', (m, isOpen) => {
                             if (!isOpen) {
                                 button.remove_style_pseudo_class('active');
                                 button.remove_style_pseudo_class('checked');
                                 
                                 if (menu.sourceActor === button) {
                                     menu.sourceActor = originalSource;
                                 }
                                 menu.disconnect(id);
                             }
                         });
                    });
                }

                box.add_child(button);
                return button;
            } catch (e) {
                console.error(`PaperWM Extra Indicators: Failed to create button for ${name}`, e);
                return null;
            }
        };

        // 1. Ubuntu AppIndicators
        try {
            const keys = Object.keys(Main.panel.statusArea).filter(k => 
                (k.toLowerCase().includes('appindicator') || 
                k.toLowerCase().includes('tray')) &&
                !k.toLowerCase().includes('paperwm') && 
                !k.toLowerCase().includes('workspace')
            );
            
            keys.forEach(key => {
                const indicator = Main.panel.statusArea[key];
                let sourceActor = null;
                if (indicator instanceof Clutter.Actor) sourceActor = indicator;
                else if (indicator.container) sourceActor = indicator.container;
                else if (indicator.actor) sourceActor = indicator.actor;
                
                let menu = indicator.menu || (indicator instanceof QuickSettings.QuickSettings ? indicator.menu : null);

                if (sourceActor) {
                     createButton(sourceActor, menu, `Indicator_${key}`);
                }
            });
        } catch(e) {
            console.error('PaperWM Extra Indicators: Failed to clone AppIndicators', e);
        }

        // 2. Date Menu
        try {
            const dateMenu = Main.panel.statusArea.dateMenu;
            if (dateMenu) {
                let source = dateMenu.container || dateMenu.actor || dateMenu;
                if (source) {
                    createButton(source, dateMenu.menu, 'DateMenu');
                }
            }
        } catch (e) {
            console.error('PaperWM Extra Indicators: Failed to clone DateMenu', e);
        }

        // 3. Input Source
        try {
            const kbdKey = Object.keys(Main.panel.statusArea).find(k => 
                k.toLowerCase().includes('keyboard') || k.toLowerCase().includes('inputsource'));
            
            let kbdItem = kbdKey ? Main.panel.statusArea[kbdKey] : null;
            if (kbdItem) {
                createButton(kbdItem, kbdItem.menu, 'KeyboardLayout');
            } else {
                // Fallback creates a new instance, so we can't bind visibility to a source.
                // We'll just create it.
                const inputIndicator = new Keyboard.InputSourceIndicator();
                if (inputIndicator) {
                    // Check if actually valid/visible? 
                    // InputSourceIndicator usually shows if >1 layouts.
                    // We can't easily check internal state, but let's assume if it was created it's okay.
                    // Or we can check Main.inputMethod.get_input_sources().length > 1?
                    // Let's just wrap it.
                    inputIndicator.visible = true;
                    
                    const btn = new St.Button({
                        style_class: 'panel-button',
                        y_align: Clutter.ActorAlign.CENTER,
                        height: Main.panel.height,
                        child: inputIndicator
                    });
                    btn.set_style('padding: 0px 8px;');
                    box.add_child(btn);
                }
            }
        } catch (e) {
            console.error('PaperWM Extra Indicators: Failed to setup InputSourceIndicator', e);
        }

        // 4. System Indicators
        try {
            const quickSettings = Main.panel.statusArea.quickSettings;
            if (quickSettings) {
                const indicatorsActor = quickSettings.get_first_child(); 
                if (indicatorsActor) {
                     createButton(indicatorsActor, quickSettings.menu, 'QuickSettings');
                }
            }
        } catch (e) {
             console.error('PaperWM Extra Indicators: Failed to clone SystemIndicators', e);
        }

        try {
            clipActor.add_child(box);
            
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
    }
}
