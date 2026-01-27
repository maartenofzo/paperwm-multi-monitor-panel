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

            // Adding 'panel' class helps themes apply hover/active styles to children
            box.add_style_class_name('panel');

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

            // Helper to create interactive panel buttons
            // We use St.Button to provide standard hover/click states matching the system panel.
            // We clone the source actor (icon) to replicate its look on the secondary monitor.
            const createButton = (sourceActor, menu, name) => {
                try {
                    const button = new St.Button({
                        style_class: 'panel-button',
                        reactive: true,
                        can_focus: true,
                        track_hover: true,
                        y_align: Clutter.ActorAlign.CENTER,
                        height: Main.panel.height
                    });
                    
                    // Explicit sizing is critical to prevent Clutter from squashing the cloned content
                    button.set_style('padding: 0px 8px; margin: 0px;');

                    const clone = new Clutter.Clone({ source: sourceActor });
                    clone.set_height(Main.panel.height);
                    clone.set_width(-1); // Natural width
                    clone.y_expand = false;
                    clone.y_align = Clutter.ActorAlign.CENTER;
                    
                    // Disable reactivity on the clone so the button receives all events
                    clone.reactive = false; 
                    clone.visible = true;
                    
                    button.set_child(clone);

                    if (menu) {
                        button.connect('clicked', () => {
                             const originalSource = menu.sourceActor;
                             
                             // Temporarily hijack the menu's source actor so the menu pops up 
                             // attached to our button on the secondary monitor.
                             menu.sourceActor = button;
                             
                             // Manually apply active states for visual feedback
                             button.add_style_pseudo_class('active');
                             button.add_style_pseudo_class('checked');
                             
                             menu.toggle();
                             
                             const id = menu.connect('open-state-changed', (m, isOpen) => {
                                 if (!isOpen) {
                                     button.remove_style_pseudo_class('active');
                                     button.remove_style_pseudo_class('checked');
                                     
                                     // Restore original source to avoid breaking the main panel behavior
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

            // 1. Ubuntu AppIndicators (Left)
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
                    
                    // Try to find the menu
                    let menu = indicator.menu || (indicator instanceof QuickSettings.QuickSettings ? indicator.menu : null);

                    if (sourceActor) {
                         createButton(sourceActor, menu, `Indicator_${key}`);
                    }
                });
            } catch(e) {
                console.error('PaperWM Extra Indicators: Failed to clone AppIndicators', e);
            }

            // 2. Date Menu (Clock/Calendar) - Center-ish
            try {
                const dateMenu = Main.panel.statusArea.dateMenu;
                if (dateMenu) {
                    // usually dateMenu.container is the actor to clone
                    let source = dateMenu.container || dateMenu.actor || dateMenu;
                    // For DateMenu, we often want the label + child.
                    // .container usually holds the Box with Label.
                    if (source) {
                        createButton(source, dateMenu.menu, 'DateMenu');
                    }
                }
            } catch (e) {
                console.error('PaperWM Extra Indicators: Failed to clone DateMenu', e);
            }

            // 3. Input Source (Keyboard Layout)
            try {
                const kbdKey = Object.keys(Main.panel.statusArea).find(k => 
                    k.toLowerCase().includes('keyboard') || k.toLowerCase().includes('inputsource'));
                
                let kbdItem = kbdKey ? Main.panel.statusArea[kbdKey] : null;
                if (kbdItem) {
                    // Input Source indicator usually has a menu too
                    createButton(kbdItem, kbdItem.menu, 'KeyboardLayout');
                } else {
                    // Fallback
                    const inputIndicator = new Keyboard.InputSourceIndicator();
                    if (inputIndicator) {
                        inputIndicator.visible = true;
                        // Wrap manually since we can't easily toggle a menu on a fresh instance
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

            // 4. System Indicators (QuickSettings) - Right
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
