import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

/**
 * PaperWM Extra Indicators
 * 
 * This extension clones system indicators (QuickSettings, DateMenu, etc.) 
 * and attaches them to PaperWM's workspace bars on non-primary monitors.
 */
const INDICATOR_CONTAINER_NAME = 'paperwm-extra-indicators';

export default class PaperWmExtraIndicators extends Extension {
    enable() {
        this._spaces = [];
        this._spaceSignals = new Map(); 
        this._panelSignals = [];
        this._checkTimer = null;
        this._childAddedId = null;
        this._rebuildIdleId = 0;
        this._monitorsChangedId = null;
        this._container = null;
        this._isRebuilding = false;

        try {
            // Delay initialization to ensure PaperWM's spaceContainer is fully realized 
            // and added to the stage before we attempt to query it.
            this._checkTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                this._startLooking();
                this._checkTimer = null;
                return GLib.SOURCE_REMOVE;
            });

            // Re-sync indicators when monitor layouts or scaling factors change.
            this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
                this._queueRebuild();
            });

            // Monitor the main panel boxes for changes (e.g., app indicators appearing/disappearing)
            // to keep the cloned indicators in sync with the source icons.
            [Main.panel._leftBox, Main.panel._centerBox, Main.panel._rightBox].forEach(box => {
                if (!box) return;
                const onPanelChanged = () => this._queueRebuild();
                this._panelSignals.push({ box, id: box.connect('child-added', onPanelChanged) });
                this._panelSignals.push({ box, id: box.connect('child-removed', onPanelChanged) });
            });
        } catch (e) {
            // Errors here typically indicate the shell UI is still initializing.
            // The checkTimer retry logic will handle subsequent discovery.
        }
    }

    disable() {
        // Stop any pending initialization or rebuild tasks.
        if (this._checkTimer) {
            GLib.source_remove(this._checkTimer);
            this._checkTimer = null;
        }

        if (this._rebuildIdleId) {
            GLib.source_remove(this._rebuildIdleId);
            this._rebuildIdleId = 0;
        }

        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = null;
        }

        // Clean up workspace container signals.
        if (this._container && this._childAddedId) {
            try {
                this._container.disconnect(this._childAddedId);
            } catch (e) {
                // Ignore errors if the container is already being destroyed during shell shutdown.
            }
            this._childAddedId = null;
        }

        // Disconnect from the main panel's boxes.
        this._panelSignals.forEach(({ box, id }) => {
            try {
                box.disconnect(id);
            } catch (e) {
                // Ignore errors if panel boxes are already finalized.
            }
        });
        this._panelSignals = [];

        // Remove indicator boxes from all tracked spaces and disconnect signals.
        this._spaces.forEach(space => this._cleanupSpace(space));
        this._spaces = [];
        this._spaceSignals.clear();
        this._container = null;
    }

    /**
     * Debounces rebuild requests to avoid excessive overhead during rapid UI changes.
     */
    _queueRebuild() {
        if (this._rebuildIdleId)
            GLib.source_remove(this._rebuildIdleId);
            
        this._rebuildIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._rebuildAll();
            this._rebuildIdleId = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Verifies if a GObject is still valid and has not been finalized in C-code.
     */
    _isValid(obj) {
        try {
            return obj && !GObject.Object.prototype.toString.call(obj).includes('Finalized');
        } catch (e) {
            return false;
        }
    }

    /**
     * Verifies if an actor is valid, on the stage, and safe to interact with.
     */
    _isValidActor(actor) {
        try {
            return this._isValid(actor) && 
                   actor instanceof Clutter.Actor && 
                   actor.get_stage() !== null;
        } catch (e) {
            return false;
        }
    }

    /**
     * Searches for PaperWM's spaceContainer in the layout manager's background group.
     */
    _startLooking() {
        const bgGroup = Main.layoutManager._backgroundGroup;
        if (!bgGroup) return;

        const container = bgGroup.get_children().find(c => c.name === 'spaceContainer');
        if (container) {
            this._connectToContainer(container);
        } else {
            // PaperWM might not be loaded yet; retry periodically.
            this._checkTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
                this._startLooking();
                this._checkTimer = null;
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    /**
     * Connects to the workspace container to track new and existing workspaces.
     */
    _connectToContainer(container) {
        this._container = container;
        this._childAddedId = container.connect('child-added', (c, actor) => {
            // Use idle_add to ensure the new space actor is fully initialized before tracking.
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._trackSpace(actor);
                return GLib.SOURCE_REMOVE;
            });
        });
        
        container.get_children().forEach(s => this._trackSpace(s));
    }

    /**
     * Sets up tracking for a PaperWM space (workspace bar container).
     */
    _trackSpace(space) {
        if (!this._isValidActor(space) || this._spaces.includes(space)) return;

        this._spaces.push(space);
        
        // Update indicators when the space's allocation changes (e.g. moving monitors).
        const allocId = space.connect('notify::allocation', () => {
             try {
                this._updateSpace(space);
             } catch (e) {
                // Allocation updates can be transient during monitor transitions.
             }
        });

        const destroyId = space.connect('destroy', () => {
            this._cleanupSpace(space);
            const index = this._spaces.indexOf(space);
            if (index > -1) this._spaces.splice(index, 1);
        });

        this._spaceSignals.set(space, [allocId, destroyId]);
        this._updateSpace(space);
    }

    /**
     * Removes indicators and disconnects all signals for a specific space.
     */
    _cleanupSpace(space) {
        if (!space) return;
        try {
            const children = space.get_children ? space.get_children() : [];
            const box = children.find(c => c && c.name === INDICATOR_CONTAINER_NAME);
            if (box) box.destroy();
        } catch (e) {
            // Indicator box might already be destroyed or inaccessible.
        }
        
        try {
            delete space._hasExtraIndicators;
        } catch (e) {
            // Metadata cleanup may fail if the space actor is already finalized.
        }

        const signals = this._spaceSignals.get(space);
        if (signals) {
            signals.forEach(id => {
                try {
                    space.disconnect(id);
                } catch (e) {
                    // Actor may be finalized before signals are disconnected.
                }
            });
            this._spaceSignals.delete(space);
        }
    }

    /**
     * Iterates through all valid spaces to refresh their indicator sets.
     */
    _rebuildAll() {
        if (this._isRebuilding) return;
        this._isRebuilding = true;
        
        const spacesCopy = this._spaces.filter(s => this._isValidActor(s));
        for (const space of spacesCopy) {
            try {
                const box = space.get_children().find(c => c && c.name === INDICATOR_CONTAINER_NAME);
                if (box) box.destroy();
                delete space._hasExtraIndicators;
                this._updateSpace(space);
            } catch (e) {
                // Silently skip spaces that are in an inconsistent state during the rebuild.
            }
        }
        this._isRebuilding = false;
    }

    /**
     * Determines whether a space needs indicators based on its monitor position.
     */
    _updateSpace(space) {
        if (!this._isValidActor(space)) return;

        const isPrimary = this._isSpaceOnPrimary(space);
        const existingBox = space.get_children().find(c => c && c.name === INDICATOR_CONTAINER_NAME);

        if (isPrimary) {
            // Remove indicators if the space moved to the primary monitor (where the main panel is).
            if (existingBox) {
                existingBox.destroy();
                delete space._hasExtraIndicators;
            }
        } else {
            // Create indicators for secondary monitors if they don't exist yet and the space has size.
            if (!existingBox && !space._hasExtraIndicators && space.width > 0) {
                this._createIndicators(space);
            }
        }
    }

    /**
     * Checks if the space is currently positioned on the primary monitor.
     */
    _isSpaceOnPrimary(space) {
        try {
            const [x, y] = space.get_transformed_position();
            const primary = Main.layoutManager.primaryMonitor;
            if (!primary || Number.isNaN(x) || Number.isNaN(y)) return true;
            return (x >= primary.x && x < primary.x + primary.width && 
                    y >= primary.y && y < primary.y + primary.height);
        } catch (e) {
            return true;
        }
    }

    /**
     * Clones relevant system indicators and attaches them to the workspace bar.
     */
    _createIndicators(clipActor) {
        if (!this._isValidActor(clipActor)) return;
        clipActor._hasExtraIndicators = true;

        // Calculate target height based on the local monitor's scaling factor.
        let targetHeight = Main.panel.height || 32;
        try {
            const primary = Main.layoutManager.primaryMonitor;
            const current = Main.layoutManager.findMonitorForActor(clipActor);
            if (primary && current && primary.geometry_scale !== current.geometry_scale) {
                targetHeight = Math.round(targetHeight * (current.geometry_scale / primary.geometry_scale));
            }
        } catch (e) {
            // Fallback to default panel height if monitor scaling cannot be determined.
        }
        if (targetHeight <= 0) targetHeight = 32;

        const box = new St.BoxLayout({
            name: INDICATOR_CONTAINER_NAME,
            reactive: true,
            height: targetHeight,
            style: `background-color: rgba(0,0,0,0.6); border-radius: 0 0 0 12px; height: ${targetHeight}px;`
        });

        /**
         * Helper to create a cloned button that mirrors a source panel icon and its menu.
         */
        const createButton = (sourceActor, menu) => {
            if (!this._isValidActor(sourceActor)) return null;
            
            try {
                // Ensure the source is mapped and visible to avoid cloning empty or ghost actors.
                if (!sourceActor.visible || !sourceActor.mapped) return null;

                const button = new St.Button({
                    style_class: 'panel-button',
                    reactive: true,
                    height: targetHeight,
                    style: 'padding: 0px 8px; margin: 0px;'
                });

                const clone = new Clutter.Clone({ 
                    source: sourceActor,
                    visible: true,
                    y_align: Clutter.ActorAlign.CENTER,
                    height: Math.min(sourceActor.height || targetHeight, targetHeight)
                });
                button.set_child(clone);

                let sourceDestroyId = 0;
                let visId = 0;
                const originalSourceActor = menu ? menu.sourceActor : null;

                // Handle the destruction of the source indicator.
                sourceDestroyId = sourceActor.connect('destroy', () => {
                    sourceDestroyId = 0;
                    if (visId > 0) { try { sourceActor.disconnect(visId); } catch (e) {} visId = 0; }
                    
                    // Detach clone source immediately to prevent segfaults in Clutter's paint cycle.
                    if (this._isValid(clone)) clone.source = null;
                    if (menu && menu.sourceActor === button) menu.sourceActor = originalSourceActor;

                    // Destroy our clone button on the next idle cycle.
                    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                        if (this._isValidActor(button)) button.destroy();
                        return GLib.SOURCE_REMOVE;
                    });
                });

                // Sync the visibility of the clone with the source indicator.
                visId = sourceActor.connect('notify::visible', () => {
                    if (this._isValidActor(button) && this._isValidActor(sourceActor)) 
                        button.visible = sourceActor.visible;
                });

                // Cleanup when the cloned button itself is destroyed.
                button.connect('destroy', () => {
                    if (this._isValid(clone)) clone.source = null;
                    if (menu && menu.sourceActor === button) menu.sourceActor = originalSourceActor;
                    
                    if (this._isValidActor(sourceActor)) {
                        if (visId > 0) try { sourceActor.disconnect(visId); } catch (e) {}
                        if (sourceDestroyId > 0) try { sourceActor.disconnect(sourceDestroyId); } catch (e) {}
                    }
                    visId = 0;
                    sourceDestroyId = 0;
                });

                // Toggle the original menu when the cloned button is clicked.
                if (menu) {
                    button.connect('clicked', () => {
                        try {
                            menu.sourceActor = button;
                            button.add_style_pseudo_class('active');
                            menu.toggle();
                            const id = menu.connect('open-state-changed', (m, isOpen) => {
                                if (!isOpen) {
                                    button.remove_style_pseudo_class('active');
                                    if (menu.sourceActor === button) menu.sourceActor = originalSourceActor;
                                    try { menu.disconnect(id); } catch (e) {}
                                }
                            });
                        } catch (e) {
                            // Menu toggle failed or menu was destroyed.
                        }
                    });
                }

                box.add_child(button);
                return button;
            } catch (e) {
                return null;
            }
        };

        const statusArea = Main.panel.statusArea;

        // Clone third-party AppIndicators and legacy system tray icons.
        ['appIndicator', 'tray', 'indicator'].forEach(type => {
            Object.keys(statusArea).forEach(key => {
                if (!key.toLowerCase().includes(type) || key.toLowerCase().includes('paperwm')) return;
                try {
                    const ind = statusArea[key];
                    if (!ind) return;
                    let src = ind.container || ind.actor || (ind instanceof Clutter.Actor ? ind : null);
                    if (src) createButton(src, ind.menu);
                } catch (e) {
                    // Skip third-party indicators that are in an inconsistent state.
                }
            });
        });

        // Clone the Date and Time menu.
        try {
            const dm = statusArea.dateMenu;
            if (dm) createButton(dm.container || dm.actor || dm, dm.menu);
        } catch (e) {}

        // Clone the Keyboard layout indicator.
        try {
            const kbdKey = Object.keys(statusArea).find(k => k.toLowerCase().includes('keyboard') || k.toLowerCase().includes('inputsource'));
            if (kbdKey && statusArea[kbdKey]) createButton(statusArea[kbdKey], statusArea[kbdKey].menu);
        } catch (e) {}

        // Clone the Quick Settings (System) indicators.
        try {
            const qs = statusArea.quickSettings;
            if (qs) {
                // In GNOME 46, we clone the specific icons container for better layout alignment.
                let icons = qs._indicators || (qs.get_first_child ? qs.get_first_child() : null);
                if (icons) createButton(icons, qs.menu);
            }
        } catch (e) {}

        try {
            if (box.get_n_children() > 0) {
                clipActor.add_child(box);
                const constraintX = new Clutter.AlignConstraint({ source: clipActor, align_axis: Clutter.AlignAxis.X_AXIS, factor: 1.0 });
                box.add_constraint(constraintX);
                clipActor.set_child_above_sibling(box, null);
            } else {
                box.destroy();
                delete clipActor._hasExtraIndicators;
            }
        } catch(e) {
            // Failed to attach indicator container to the space actor.
        }
    }
}
