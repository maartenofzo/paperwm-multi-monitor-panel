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
        console.log('PaperWM Extra Indicators: [ENABLE] Starting...');
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
            this._checkTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                this._startLooking();
                this._checkTimer = null;
                return GLib.SOURCE_REMOVE;
            });

            this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
                this._queueRebuild('monitors-changed');
            });

            [Main.panel._leftBox, Main.panel._centerBox, Main.panel._rightBox].forEach((box, i) => {
                const name = ['left', 'center', 'right'][i];
                if (!box) return;
                const onPanelChanged = () => this._queueRebuild(`panel-${name}-change`);
                this._panelSignals.push({ box, id: box.connect('child-added', onPanelChanged) });
                this._panelSignals.push({ box, id: box.connect('child-removed', onPanelChanged) });
            });
        } catch (e) {
            console.log(`PaperWM Extra Indicators: [ERROR] Enable failed: ${e.message}`);
        }
        console.log('PaperWM Extra Indicators: [ENABLE] Complete');
    }

    disable() {
        console.log('PaperWM Extra Indicators: [DISABLE] Starting...');
        if (this._checkTimer) { GLib.source_remove(this._checkTimer); this._checkTimer = null; }
        if (this._rebuildIdleId) { GLib.source_remove(this._rebuildIdleId); this._rebuildIdleId = 0; }
        if (this._monitorsChangedId) { Main.layoutManager.disconnect(this._monitorsChangedId); this._monitorsChangedId = null; }
        if (this._container && this._childAddedId) {
            try { this._container.disconnect(this._childAddedId); } catch (e) {}
            this._childAddedId = null;
        }
        this._panelSignals.forEach(({ box, id }) => { try { box.disconnect(id); } catch (e) {} });
        this._panelSignals = [];
        this._spaces.forEach((space) => this._cleanupSpace(space));
        this._spaces = [];
        this._spaceSignals.clear();
        console.log('PaperWM Extra Indicators: [DISABLE] Complete');
    }

    _queueRebuild(reason) {
        if (this._rebuildIdleId) GLib.source_remove(this._rebuildIdleId);
        this._rebuildIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._rebuildAll(reason);
            this._rebuildIdleId = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    _isValid(obj) {
        try {
            return obj && !GObject.Object.prototype.toString.call(obj).includes('Finalized');
        } catch (e) { return false; }
    }

    _isValidActor(actor) {
        try {
            return this._isValid(actor) && 
                   actor instanceof Clutter.Actor && 
                   actor.get_stage() !== null;
        } catch (e) { return false; }
    }

    _startLooking() {
        const bgGroup = Main.layoutManager._backgroundGroup;
        if (!bgGroup) return;
        const container = bgGroup.get_children().find(c => c.name === 'spaceContainer');
        if (container) {
            console.log('PaperWM Extra Indicators: [RESEARCH] Found spaceContainer');
            this._connectToContainer(container);
        } else {
            this._checkTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
                this._startLooking();
                this._checkTimer = null;
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _connectToContainer(container) {
        this._container = container;
        this._childAddedId = container.connect('child-added', (c, actor) => {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => { this._trackSpace(actor); return GLib.SOURCE_REMOVE; });
        });
        container.get_children().forEach(s => this._trackSpace(s));
    }

    _trackSpace(space) {
        if (!this._isValidActor(space) || this._spaces.includes(space)) return;
        console.log(`PaperWM Extra Indicators: [SPACE] Tracking space: ${space.name || 'unnamed'}`);
        this._spaces.push(space);
        const allocId = space.connect('notify::allocation', () => { try { this._updateSpace(space); } catch (e) {} });
        const destroyId = space.connect('destroy', () => {
            this._cleanupSpace(space);
            const index = this._spaces.indexOf(space);
            if (index > -1) this._spaces.splice(index, 1);
        });
        this._spaceSignals.set(space, [allocId, destroyId]);
        this._updateSpace(space);
    }

    _cleanupSpace(space) {
        if (!space) return;
        try {
            const children = space.get_children ? space.get_children() : [];
            const box = children.find(c => c && c.name === INDICATOR_CONTAINER_NAME);
            if (box) box.destroy();
        } catch (e) {}
        try { delete space._hasExtraIndicators; } catch (e) {}
        const signals = this._spaceSignals.get(space);
        if (signals) {
            signals.forEach(id => { try { space.disconnect(id); } catch (e) {} });
            this._spaceSignals.delete(space);
        }
    }

    _rebuildAll(reason) {
        if (this._isRebuilding) return;
        this._isRebuilding = true;
        console.log(`PaperWM Extra Indicators: [REBUILD] Starting (${reason})`);
        
        const spacesCopy = this._spaces.filter(s => this._isValidActor(s));
        for (const space of spacesCopy) {
            try {
                const box = space.get_children().find(c => c && c.name === INDICATOR_CONTAINER_NAME);
                if (box) box.destroy();
                delete space._hasExtraIndicators;
                this._updateSpace(space);
            } catch (e) {
                console.log(`PaperWM Extra Indicators: [ERROR] Rebuild failed for space: ${e.message}`);
            }
        }
        console.log('PaperWM Extra Indicators: [REBUILD] Complete');
        this._isRebuilding = false;
    }

    _updateSpace(space) {
        if (!this._isValidActor(space)) return;
        const isPrimary = this._isSpaceOnPrimary(space);
        const existingBox = space.get_children().find(c => c && c.name === INDICATOR_CONTAINER_NAME);

        if (isPrimary) {
            if (existingBox) { existingBox.destroy(); delete space._hasExtraIndicators; }
        } else {
            // Allow creation if width is valid, even if allocation isn't perfect yet
            if (!existingBox && !space._hasExtraIndicators && space.width > 0) {
                this._createIndicators(space);
            }
        }
    }

    _isSpaceOnPrimary(space) {
        try {
            const [x, y] = space.get_transformed_position();
            const primary = Main.layoutManager.primaryMonitor;
            if (!primary || Number.isNaN(x) || Number.isNaN(y)) return true;
            return (x >= primary.x && x < primary.x + primary.width && y >= primary.y && y < primary.y + primary.height);
        } catch (e) { return true; }
    }

    _createIndicators(clipActor) {
        if (!this._isValidActor(clipActor)) return;
        clipActor._hasExtraIndicators = true;

        let targetHeight = Main.panel.height || 32;
        try {
            const primary = Main.layoutManager.primaryMonitor;
            const current = Main.layoutManager.findMonitorForActor(clipActor);
            if (primary && current && primary.geometry_scale !== current.geometry_scale) {
                targetHeight = Math.round(targetHeight * (current.geometry_scale / primary.geometry_scale));
            }
        } catch (e) {}
        if (targetHeight <= 0) targetHeight = 32;

        console.log(`PaperWM Extra Indicators: [CREATE] Creating indicators for space at height ${targetHeight}`);

        const box = new St.BoxLayout({
            name: INDICATOR_CONTAINER_NAME,
            reactive: true,
            height: targetHeight,
            style: `background-color: rgba(0,0,0,0.6); border-radius: 0 0 0 12px; height: ${targetHeight}px;`
        });

        const createButton = (sourceActor, menu, name) => {
            if (!this._isValidActor(sourceActor)) return null;
            
            try {
                // Only clone actors that are visible and realized
                if (!sourceActor.visible || !sourceActor.mapped) return null;
                console.log(`PaperWM Extra Indicators: [CREATE] Attempting ${name}`);

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

                sourceDestroyId = sourceActor.connect('destroy', () => {
                    sourceDestroyId = 0;
                    if (visId > 0) { try { sourceActor.disconnect(visId); } catch (e) {} visId = 0; }
                    
                    // CRITICAL: Detach clone immediately
                    if (this._isValid(clone)) clone.source = null;
                    if (menu && menu.sourceActor === button) menu.sourceActor = originalSourceActor;

                    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                        if (this._isValidActor(button)) button.destroy();
                        return GLib.SOURCE_REMOVE;
                    });
                });

                visId = sourceActor.connect('notify::visible', () => {
                    if (this._isValidActor(button) && this._isValidActor(sourceActor)) 
                        button.visible = sourceActor.visible;
                });

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
                        } catch (e) {}
                    });
                }

                box.add_child(button);
                console.log(`PaperWM Extra Indicators: [CREATE] Success ${name}`);
                return button;
            } catch (e) {
                console.log(`PaperWM Extra Indicators: [ERROR] Failed to create button for ${name}: ${e.message}`);
                return null;
            }
        };

        const statusArea = Main.panel.statusArea;

        // 1. AppIndicators & Tray
        ['appIndicator', 'tray', 'indicator'].forEach(type => {
            Object.keys(statusArea).forEach(key => {
                if (!key.toLowerCase().includes(type) || key.toLowerCase().includes('paperwm')) return;
                try {
                    const ind = statusArea[key];
                    if (!ind) return;
                    let src = ind.container || ind.actor || (ind instanceof Clutter.Actor ? ind : null);
                    if (src) createButton(src, ind.menu, key);
                } catch (e) {}
            });
        });

        // 2. DateMenu
        try {
            const dm = statusArea.dateMenu;
            if (dm) createButton(dm.container || dm.actor || dm, dm.menu, 'DateMenu');
        } catch (e) {}

        // 3. Keyboard
        try {
            const kbdKey = Object.keys(statusArea).find(k => k.toLowerCase().includes('keyboard') || k.toLowerCase().includes('inputsource'));
            if (kbdKey && statusArea[kbdKey]) createButton(statusArea[kbdKey], statusArea[kbdKey].menu, 'KeyboardLayout');
        } catch (e) {}

        // 4. QuickSettings
        try {
            const qs = statusArea.quickSettings;
            if (qs) {
                // Find indicators safely in GNOME 46
                let icons = qs._indicators || (qs.get_first_child ? qs.get_first_child() : null);
                if (icons) createButton(icons, qs.menu, 'QuickSettings');
            }
        } catch (e) {}

        try {
            if (box.get_n_children() > 0) {
                clipActor.add_child(box);
                const constraintX = new Clutter.AlignConstraint({ source: clipActor, align_axis: Clutter.AlignAxis.X_AXIS, factor: 1.0 });
                box.add_constraint(constraintX);
                clipActor.set_child_above_sibling(box, null);
                console.log(`PaperWM Extra Indicators: [CREATE] Attached ${box.get_n_children()} indicators`);
            } else {
                box.destroy();
                delete clipActor._hasExtraIndicators;
            }
        } catch(e) {
            console.log(`PaperWM Extra Indicators: [ERROR] Final attachment failed: ${e.message}`);
        }
    }
}
