// Copyright (C) 2011-2021 R M Yorston
// Licence: GPLv2+

const { Atk, Clutter, Gio, GLib, GObject, Meta, Pango, Shell, St } = imports.gi;
const Signals = imports.signals;

const CheckBox = imports.ui.checkBox;
const Main = imports.ui.main;
const ModalDialog = imports.ui.modalDialog;
const PopupMenu = imports.ui.popupMenu;
const WindowManager = imports.ui.windowManager;
const WorkspaceSwitcherPopup = imports.ui.workspaceSwitcherPopup;

const ExtensionUtils = imports.misc.extensionUtils;

const _f = imports.gettext.domain('frippery-bottom-panel').gettext;

const BOTTOM_PANEL_TOOLTIP_SHOW_TIME = 0.15;
const BOTTOM_PANEL_TOOLTIP_HIDE_TIME = 0.1;
const BOTTOM_PANEL_HOVER_TIMEOUT = 300;

const OVERRIDES_SCHEMA = 'org.gnome.mutter';
const WM_SCHEMA = 'org.gnome.desktop.wm.preferences';

const SETTINGS_NUM_ROWS = 'num-rows';
const SETTINGS_ENABLE_PANEL = 'enable-panel';
const SETTINGS_SHOW_PANEL = 'show-panel';
const SETTINGS_NUM_WORKSPACES = 'num-workspaces';

let show_panel = [];
let enable_panel = true;
let save_wsdata = [];

/*
 * This is a base class for containers that manage the tooltips of their
 * children.  Each child actor with a tooltip should be connected to
 * the container hover handler:
 *
 *    item.actor.connect('notify::hover', () => this._onHover(item));
 *
 */
const TooltipContainer =
class TooltipContainer {
    constructor() {
        this._showTooltipTimeoutId = 0;
        this._resetHoverTimeoutId = 0;
        this._tooltipShowing = false;
    }

    _onHover(item) {
        if ( item.actor.hover ) {
            if (this._showTooltipTimeoutId == 0) {
                let timeout = this._tooltipShowing ?
                                0 : BOTTOM_PANEL_HOVER_TIMEOUT;
                this._showTooltipTimeoutId = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT, timeout,
                    () => {
                        this._tooltipShowing = true;
                        item.showTooltip(this);
                        this._showTooltipTimeoutId = 0;
                        return GLib.SOURCE_REMOVE;
                    });
                if (this._resetHoverTimeoutId > 0) {
                    GLib.source_remove(this._resetHoverTimeoutId);
                    this._resetHoverTimeoutId = 0;
                }
            }
        } else {
            if (this._showTooltipTimeoutId > 0) {
                GLib.source_remove(this._showTooltipTimeoutId);
                this._showTooltipTimeoutId = 0;
            }
            item.hideTooltip();
            if (this._tooltipShowing) {
                this._resetHoverTimeoutId = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT, BOTTOM_PANEL_HOVER_TIMEOUT, () => {
                        this._tooltipShowing = false;
                        this._resetHoverTimeoutId = 0;
                        return GLib.SOURCE_REMOVE;
                    });
            }
        }
    }
};

/*
 * This is a base class for child items that have a tooltip and which allow
 * the hover handler in the parent container class to show/hide the tooltip.
 */
const TooltipChild =
class TooltipChild {
    constructor() {
    }

    showTooltip(container) {
        this.tooltip.opacity = 0;
        this.tooltip.show();

        let [stageX, stageY] = this.actor.get_transformed_position();

        let itemHeight = this.actor.allocation.y2 - this.actor.allocation.y1;
        let itemWidth = this.actor.allocation.x2 - this.actor.allocation.x1;
        let tooltipWidth = this.tooltip.get_width();

        let node = this.tooltip.get_theme_node();
        let yOffset = node.get_length('-y-offset');

        let y = stageY - itemHeight - yOffset;
        let x = Math.floor(stageX + itemWidth/2 - tooltipWidth/2);

        let parent = this.tooltip.get_parent();
        let parentWidth = parent.allocation.x2 - parent.allocation.x1;

        if ( Clutter.get_default_text_direction() == Clutter.TextDirection.LTR ) {
            // stop long tooltips falling off the right of the screen
            x = Math.min(x, parentWidth-tooltipWidth-6);
            // but whatever happens don't let them fall of the left
            x = Math.max(x, 6);
        }
        else {
            x = Math.max(x, 6);
            x = Math.min(x, parentWidth-tooltipWidth-6);
        }

        this.tooltip.set_position(x, y);
        this.tooltip.remove_all_transitions();
        this.tooltip.ease({
            opacity: 255,
            duration: BOTTOM_PANEL_TOOLTIP_SHOW_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD
        });
    }

    hideTooltip() {
        this.tooltip.opacity = 255;

        this.tooltip.remove_all_transitions();
        this.tooltip.ease({
            opacity: 0,
            duration: BOTTOM_PANEL_TOOLTIP_HIDE_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this.tooltip.hide()
        });
    }
};

const MAX_BOTH = Meta.MaximizeFlags.HORIZONTAL | Meta.MaximizeFlags.VERTICAL;

const WindowListItemMenu =
class WindowListItemMenu extends PopupMenu.PopupMenu {
    constructor(metaWindow, actor) {
        super(actor, 0.0, St.Side.BOTTOM, 0);

        Main.uiGroup.add_actor(this.actor);
        this.actor.hide();

        this.metaWindow = metaWindow;

        this.connect('open-state-changed', this._onToggled.bind(this));

        let text = metaWindow.minimized ? _f('Unminimize') : _('Minimize');
        let item = new PopupMenu.PopupMenuItem(text);
        item.connect('activate', this._onMinimizeWindowActivate.bind(this));
        this.addMenuItem(item);
        this.itemMinimizeWindow = item;

        text = metaWindow.get_maximized == MAX_BOTH ?
                _('Unmaximize') : _('Maximize');
        item = new PopupMenu.PopupMenuItem(text);
        item.connect('activate', this._onMaximizeWindowActivate.bind(this));
        this.addMenuItem(item);
        this.itemMaximizeWindow = item;

        item = new PopupMenu.PopupMenuItem(_('Always on Top'));
        item.connect('activate', this._onOnTopWindowToggle.bind(this));
        if ( metaWindow.above ) {
            item.setOrnament(PopupMenu.Ornament.DOT);
        }
        this.addMenuItem(item);
        this.itemOnTopWindow = item;

        item = new PopupMenu.PopupMenuItem(_('Always on Visible Workspace'));
        item.connect('activate', this._onStickyWindowToggle.bind(this));
        if ( metaWindow.is_on_all_workspaces() ) {
            item.setOrnament(PopupMenu.Ornament.DOT);
        }
        this.addMenuItem(item);
        this.itemStickyWindow = item;

        this.itemMove = [];

        let directions = [
            { text: _f('Move to Workspace Left'),
              direction: Meta.MotionDirection.LEFT },
            { text: _f('Move to Workspace Right'),
              direction: Meta.MotionDirection.RIGHT },
            { text: _('Move to Workspace Up'),
              direction: Meta.MotionDirection.UP },
            { text: _('Move to Workspace Down'),
              direction: Meta.MotionDirection.DOWN }
        ];

        for ( let i=0; i<directions.length; ++i ) {
            item = new PopupMenu.PopupMenuItem(directions[i].text);
            item.direction = directions[i].direction;
            item.connect('activate', this._onMoveWindowActivate.bind(this));
            this.addMenuItem(item);
            this.itemMove.push(item);
        }

        item = new PopupMenu.PopupSubMenuMenuItem(
                        _f('Move to Another Workspace'));
        this.addMenuItem(item);
        this._buildWorkspaceSubMenu(item.menu);
        this.workspaceSubMenu = item.menu;

        let separator = new PopupMenu.PopupSeparatorMenuItem();
        this.addMenuItem(separator);

        item = new PopupMenu.PopupMenuItem(_('Close'));
        item.connect('activate', this._onCloseWindowActivate.bind(this));
        this.addMenuItem(item);
    }

    _buildWorkspaceSubMenu(submenu) {
        for ( let j=0; j<global.workspace_manager.n_workspaces; ++j ) {
            let active = global.workspace_manager.get_active_workspace_index();
            let item = new PopupMenu.PopupMenuItem(
                            Meta.prefs_get_workspace_name(j));
            item.index = j;
            item.connect('activate', this._onMoveToActivate.bind(this));
            item.setSensitive(j != active);
            submenu.addMenuItem(item, j);
        }
    }

    _onToggled(actor, state) {
        if ( !state ) {
            return;
        }

        let text = this.metaWindow.minimized ?
                _f('Unminimize') : _('Minimize');
        this.itemMinimizeWindow.label.set_text(text);

        text = this.metaWindow.get_maximized() == MAX_BOTH ?
                _('Unmaximize') : _('Maximize');
        this.itemMaximizeWindow.label.set_text(text);

        if ( this.metaWindow.is_above() ) {
            this.itemOnTopWindow.setOrnament(PopupMenu.Ornament.DOT);
        }
        else {
            this.itemOnTopWindow.setOrnament(PopupMenu.Ornament.NONE);
        }

        if ( this.metaWindow.is_on_all_workspaces() ) {
            this.itemStickyWindow.setOrnament(PopupMenu.Ornament.DOT);
        }
        else {
            this.itemStickyWindow.setOrnament(PopupMenu.Ornament.NONE);
        }

        let ws1 = global.workspace_manager.get_active_workspace();

        for ( let i=0; i<this.itemMove.length; ++i ) {
            let ws2 = ws1.get_neighbor(this.itemMove[i].direction);
            if ( ws1 != ws2 ) {
                this.itemMove[i].actor.show();
            }
            else {
                this.itemMove[i].actor.hide();
            }
        }

        if ( this.workspaceSubMenu.numMenuItems !=
                global.workspace_manager.n_workspaces ) {
            this.workspaceSubMenu.removeAll();
            this._buildWorkspaceSubMenu(this.workspaceSubMenu);
        }
    }

    _onMinimizeWindowActivate(actor, event) {
        if ( this.metaWindow.minimized ) {
            this.metaWindow.activate(global.get_current_time());
            this.itemMinimizeWindow.label.set_text(_('Minimize'));
        }
        else {
            this.metaWindow.minimize(global.get_current_time());
            this.itemMinimizeWindow.label.set_text(_f('Unminimize'));
        }
    }

    _onMaximizeWindowActivate(actor, event) {
        if ( this.metaWindow.get_maximized() == MAX_BOTH ) {
            this.metaWindow.unmaximize(MAX_BOTH);
            this.itemMaximizeWindow.label.set_text(_('Maximize'));
        }
        else {
            this.metaWindow.maximize(MAX_BOTH);
            this.itemMaximizeWindow.label.set_text(_('Unmaximize'));
        }
    }

    _onOnTopWindowToggle(item, event) {
        if ( this.metaWindow.is_above() ) {
            item.setOrnament(PopupMenu.Ornament.NONE);
            this.metaWindow.unmake_above();
        }
        else {
            item.setOrnament(PopupMenu.Ornament.DOT);
            this.metaWindow.make_above();
        }
    }

    _onStickyWindowToggle(item, event) {
        if ( this.metaWindow.is_on_all_workspaces() ) {
            item.setOrnament(PopupMenu.Ornament.NONE);
            this.metaWindow.unstick();
        }
        else {
            item.setOrnament(PopupMenu.Ornament.DOT);
            this.metaWindow.stick();
        }
    }

    _onMoveWindowActivate(item, event) {
        let ws1 = global.workspace_manager.get_active_workspace();
        let ws2 = ws1.get_neighbor(item.direction);
        if ( ws2 && ws1 != ws2 ) {
            this.metaWindow.change_workspace(ws2);
        }
    }

    _onMoveToActivate(item, event) {
        let ws1 = global.workspace_manager.get_active_workspace();
        let ws2 = global.workspace_manager.get_workspace_by_index(item.index);
        if ( ws2 && ws1 != ws2 ) {
            this.metaWindow.change_workspace(ws2);
        }
    }

    _onCloseWindowActivate(actor, event) {
        this.metaWindow.delete(global.get_current_time());
    }
};

const WindowListItem =
class WindowListItem extends TooltipChild {
    constructor(myWindowList, app, metaWindow) {
        super();

        this.metaWindow = metaWindow;
        this.myWindowList = myWindowList;

        this.actor = new St.Bin({
                            reactive: true,
                            track_hover: true,
                            y_align: Clutter.ActorAlign.CENTER,
                            can_focus: true});
        this.actor._delegate = this;

        let title = metaWindow.title ? metaWindow.title : ' ';

        this.tooltip = new St.Label({ style_class: 'bottom-panel-tooltip'});
        this.tooltip.set_text(title);
        this.tooltip.hide();
        Main.layoutManager.addChrome(this.tooltip);
        this.actor.label_actor = this.tooltip;

        this._itemBox = new St.BoxLayout({style_class: 'window-list-item-box'});
        this.actor.add_actor(this._itemBox);

        this.icon = app ? app.create_icon_texture(16) :
                          new St.Icon({
                                    icon_name: 'icon-missing',
                                    icon_size: 16,
                                    x_align: Clutter.ActorAlign.CENTER,
                                    y_align: Clutter.ActorAlign.CENTER});

        if ( !metaWindow.showing_on_its_workspace() ) {
            title = '[' + title + ']';
        }

        this.label = new St.Label({
                            style_class: 'window-list-item-label',
                            y_align: Clutter.ActorAlign.CENTER,
                            text: title});
        this.label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._itemBox.add(this.icon);
        this._itemBox.add(this.label);

        this.rightClickMenu = new WindowListItemMenu(metaWindow, this.actor);

        this._notifyTitleId = metaWindow.connect('notify::title',
                                    this._onTitleChanged.bind(this));
        this._notifyMinimizedId = metaWindow.connect('notify::minimized',
                                    this._onMinimizedChanged.bind(this));
        this._notifyFocusId =
            global.display.connect('notify::focus-window',
                                    this._onFocus.bind(this));

        this.actor.connect('destroy', this._onDestroy.bind(this));
        this.actor.connect('button-press-event',
                                    this._onButtonPress.bind(this));
        this.actor.connect('button-release-event',
                                    this._onButtonRelease.bind(this));
        this.actor.connect('notify::allocation',
                                    this._updateIconGeometry.bind(this));

        this._onFocus();
    }

    _getIndex() {
        return this.myWindowList._windows.indexOf(this);
    }

    _onTitleChanged() {
        let title = this.metaWindow.title;
        this.tooltip.set_text(title);
        if ( this.metaWindow.minimized ) {
            title = '[' + title + ']';
        }
        this.label.set_text(title);
    }

    _onMinimizedChanged() {
        if ( this.metaWindow.minimized ) {
            this.icon.opacity = 127;
            this.label.text = '[' + this.metaWindow.title + ']';
        }
        else {
            this.icon.opacity = 255;
            this.label.text = this.metaWindow.title;
        }
    }

    _onDestroy() {
        this.metaWindow.disconnect(this._notifyTitleId);
        this.metaWindow.disconnect(this._notifyMinimizedId);
        global.display.disconnect(this._notifyFocusId);
        this.tooltip.destroy();
        this.rightClickMenu.destroy();
    }

    _onButtonPress(actor, event) {
        let button = event.get_button();

        if ( this.rightClickMenu.isOpen ) {
            this.rightClickMenu.close();
        }
        else if ( !this.rightClickMenu.isOpen && button == 1 ) {
            // start dragging
            this.myWindowList.dragIndex = this._getIndex();
        }
        else if ( button == 3 ) {
            this.hideTooltip();
            this.rightClickMenu.open();
        }
    }

    _onButtonRelease(actor, event) {
        let button = event.get_button();

        if ( button == 1 ) {
            // do not drag if same window list item
            if ( this._getIndex() == this.myWindowList.dragIndex ) {
                if ( this.metaWindow.has_focus() ) {
                    this.metaWindow.minimize();
                }
                else {
                    this.metaWindow.activate(global.get_current_time());
                }
            }
            else {
                // perform drag
                let index = global.workspace_manager.get_active_workspace().index();
                let windowSeq = this.myWindowList._wsdata[index].windowSeq;

                let value = windowSeq[this.myWindowList.dragIndex];
                windowSeq.splice(this.myWindowList.dragIndex, 1);
                windowSeq.splice(this._getIndex(), 0, value);

                this.myWindowList._refreshItems();
            }
            this.myWindowList.dragIndex = -1;
        }
    }

    _onFocus() {
        if ( this.metaWindow.has_focus() ) {
            this._itemBox.add_style_pseudo_class('focused');
        }
        else {
            this._itemBox.remove_style_pseudo_class('focused');
        }

        if ( this.metaWindow.minimized ) {
            this._itemBox.add_style_pseudo_class('minimized');
        }
        else {
            this._itemBox.remove_style_pseudo_class('minimized');
        }
    }

    _updateIconGeometry() {
        let rect = new Meta.Rectangle();

        [rect.x, rect.y] = this.actor.get_transformed_position();
        [rect.width, rect.height] = this.actor.get_transformed_size();

        this.metaWindow.set_icon_geometry(rect);
    }
};

const WindowList =
class WindowList extends TooltipContainer {
    constructor() {
        super();

        this.actor = new St.BoxLayout({
                            name: 'windowList',
                            x_expand: true,
                            style_class: 'window-list-box' });
        this.actor._delegate = this;
        this._windows = [];
        this.dragIndex = -1;

        this._onSwitchWorkspaceId = global.window_manager.connect(
                                        'switch-workspace',
                                        this._refreshItems.bind(this));

        this._wsdata = save_wsdata;
        this._changeWorkspaces();

        this._onNWorkspacesId = global.workspace_manager.connect(
                                'notify::n-workspaces',
                                this._changeWorkspaces.bind(this));

        this._menuManager = new PopupMenu.PopupMenuManager(this.actor);
        this._refreshItems();

        this.actor.connect('destroy', this._onDestroy.bind(this));
    }

    _onHover(item) {
        if ( item.rightClickMenu.isOpen ) {
            item.hideTooltip();
        }
        else {
            super._onHover(item);
        }
    }

    _addListItem(metaWindow) {
        if ( metaWindow && !metaWindow.skip_taskbar ) {
            let tracker = Shell.WindowTracker.get_default();
            let app = tracker.get_window_app(metaWindow);
            if ( app ) {
                let item = new WindowListItem(this, app, metaWindow);
                this._windows.push(item);
                this.actor.add(item.actor);
                item.onHoverCallbackId = item.actor.connect('notify::hover',
                        () => this._onHover(item));
                this._menuManager.addMenu(item.rightClickMenu);
            }
        }
    }

    _refreshItems() {
        let i, j;

        for (let item of this._windows) {
            if (item.onHoverCallbackId) {
                item.actor.disconnect(item.onHoverCallbackId);
            }
        }
        this.actor.destroy_all_children();
        this._windows = [];

        let metaWorkspace = global.workspace_manager.get_active_workspace();
        let windows = metaWorkspace.list_windows().filter(function(metaWindow) {
            return metaWindow.get_window_type() != Meta.WindowType.DESKTOP;
        });
        let index = metaWorkspace.index();
        let windowSeq = this._wsdata[index].windowSeq;

        // add sequence numbers for any windows we don't know about
        for ( i=0; i < windows.length; ++i ) {
            let seqi = windows[i].get_stable_sequence();
            if ( windowSeq.indexOf(seqi) == -1 ) {
                windowSeq.push(seqi);
            }
        }

        // remove sequence numbers that don't correspond to a window
        for ( j=windowSeq.length-1; j >= 0; --j ) {
            for ( i=0; i < windows.length; ++i ) {
                if ( windowSeq[j] == windows[i].get_stable_sequence() ) {
                    break;
                }
            }
            if ( i == windows.length ) {
                windowSeq.splice(j, 1);
            }
        }

        // sort windows by position in windowSeq array
        windows.sort(function(w1, w2) {
            let i1 = windowSeq.indexOf(w1.get_stable_sequence());
            let i2 = windowSeq.indexOf(w2.get_stable_sequence());
            return i1 - i2;
        });

        // Create list items for each window
        for ( let i = 0; i < windows.length; ++i ) {
            this._addListItem(windows[i]);
        }
    }

    _windowAdded(metaWorkspace, metaWindow) {
        let index = metaWorkspace.index();
        let seq = metaWindow.get_stable_sequence();
        this._wsdata[index].windowSeq.push(seq);

        if ( index != global.workspace_manager.get_active_workspace_index() ) {
            return;
        }

        for ( let i=0; i<this._windows.length; ++i ) {
            if ( this._windows[i].metaWindow == metaWindow ) {
                return;
            }
        }

        this._addListItem(metaWindow);
    }

    _windowRemoved(metaWorkspace, metaWindow) {
        let index = metaWorkspace.index();
        let seq = metaWindow.get_stable_sequence();
        let windowSeq = this._wsdata[index].windowSeq;

        let j = windowSeq.indexOf(seq);
        if ( j != -1 ) {
            windowSeq.splice(j, 1);
        }

        if ( index != global.workspace_manager.get_active_workspace_index() ) {
            return;
        }

        for ( let i=0; i<this._windows.length; ++i ) {
            if ( this._windows[i].metaWindow == metaWindow ) {
                this.actor.remove_actor(this._windows[i].actor);
                this._windows[i].actor.destroy();
                this._windows.splice(i, 1);
                break;
            }
        }
    }

    _disconnectCallbacks() {
        for ( let i=0;
                i<this._wsdata.length &&
                    i<global.workspace_manager.n_workspaces;
                ++i ) {
            let wd = this._wsdata[i];
            let ws = global.workspace_manager.get_workspace_by_index(i);

            if (wd.windowAddedId)
                ws.disconnect(wd.windowAddedId);
            if (wd.windowRemovedId)
                ws.disconnect(wd.windowRemovedId);

            wd.windowAddedId = 0;
            wd.windowRemovedId = 0;
        }
    }

    _changeWorkspaces() {
        this._disconnectCallbacks();

        // truncate arrays to number of workspaces
        if ( this._wsdata.length > global.workspace_manager.n_workspaces ) {
            this._wsdata.length = global.workspace_manager.n_workspaces;
        }

        if ( show_panel.length > global.workspace_manager.n_workspaces ) {
            show_panel.length = global.workspace_manager.n_workspaces;
        }

        for ( let i=0; i<global.workspace_manager.n_workspaces; ++i ) {
            // add data for new workspaces
            if ( i >= this._wsdata.length ) {
                this._wsdata[i] = {};
                this._wsdata[i].windowSeq = [];
            }

            if ( i >= show_panel.length ) {
                show_panel[i] = true;
            }

            let ws = global.workspace_manager.get_workspace_by_index(i);
            this._wsdata[i].windowAddedId = ws.connect('window-added',
                                    this._windowAdded.bind(this));
            this._wsdata[i].windowRemovedId = ws.connect('window-removed',
                                    this._windowRemoved.bind(this));
        }
    }

    _onDestroy() {
        this._disconnectCallbacks();
        global.window_manager.disconnect(this._onSwitchWorkspaceId);
        global.workspace_manager.disconnect(this._onNWorkspacesId);
        save_wsdata = this._wsdata;
    }
};

let nrows = 1;

function get_ncols() {
    let ncols = Math.floor(global.workspace_manager.n_workspaces/nrows);
    if ( global.workspace_manager.n_workspaces%nrows != 0 )
       ++ncols

    return ncols;
}

var Switch = class {
    constructor(state) {
        this.actor = new St.Bin({ style_class: 'toggle-switch',
                                  accessible_role: Atk.Role.CHECK_BOX,
                                  can_focus: true });
        this.setToggleState(state);
    }

    setToggleState(state) {
        if (state)
            this.actor.add_style_pseudo_class('checked');
        else
            this.actor.remove_style_pseudo_class('checked');
        this.state = state;
    }

    toggle() {
        this.setToggleState(!this.state);
    }
};

const ToggleSwitch =
class ToggleSwitch extends Switch {
    constructor(state) {
        super(state);

        this.actor.can_focus = true;
        this.actor.reactive = true;
        this.actor.add_style_class_name('bottom-panel-toggle-switch');

        this.actor.connect('button-release-event',
                this._onButtonReleaseEvent.bind(this));
        this.actor.connect('key-press-event', this._onKeyPressEvent.bind(this));
        this.actor.connect('key-focus-in', this._onKeyFocusIn.bind(this));
        this.actor.connect('key-focus-out', this._onKeyFocusOut.bind(this));
    }

    _onButtonReleaseEvent(actor, event) {
        this.toggle();
        return true;
    }

    _onKeyPressEvent(actor, event) {
        let symbol = event.get_key_symbol();

        if (symbol == Clutter.KEY_space || symbol == Clutter.KEY_Return) {
            this.toggle();
            return true;
        }

        return false;
    }

    _onKeyFocusIn(actor) {
        actor.add_style_pseudo_class('active');
    }

    _onKeyFocusOut(actor) {
        actor.remove_style_pseudo_class('active');
    }
};

const DynamicWorkspacesSwitch =
class DynamicWorkspacesSwitch extends ToggleSwitch {
    constructor() {
        super(true);
        this._settings = new Gio.Settings({ schema: OVERRIDES_SCHEMA });
        this.updateState();
    }

    updateState() {
        this.setToggleState(this._settings.get_boolean('dynamic-workspaces'));
    }

    toggle() {
        super.toggle();
        this._settings.set_boolean('dynamic-workspaces', this.state);
    }
};

const EnablePanelSwitch =
class EnablePanelSwitch extends ToggleSwitch {
    constructor(dialog) {
        super(true);
        this._dialog = dialog;
        this._settings = ExtensionUtils.getSettings();
        this.updateState();
    }

    updateState() {
        this.setToggleState(this._settings.get_boolean(SETTINGS_ENABLE_PANEL));
    }

    toggle() {
        super.toggle();
        this._settings.set_boolean(SETTINGS_ENABLE_PANEL, this.state);

        for ( let i=0; i<this._dialog.cb.length; ++i ) {
            this._dialog.cb[i].reactive = this.state;
            this._dialog.cb[i].can_focus = this.state;
        }
    }
};

var WorkspaceDialog = GObject.registerClass(
class WorkspaceDialog extends ModalDialog.ModalDialog {
    _init() {
        super._init({ styleClass: 'workspace-dialog' });

        this.wm_settings = new Gio.Settings({ schema: WM_SCHEMA });

        let layout = new Clutter.GridLayout();
        let table = new St.Widget({
                            reactive: true,
                            layout_manager: layout,
                            y_align: Clutter.ActorAlign.START,
                            styleClass: 'workspace-dialog-grid'});
        layout.hookup_style(table);
        this.contentLayout.add(table);

        let label = new St.Label({
                            style_class: 'workspace-dialog-label',
                            y_align: Clutter.ActorAlign.CENTER,
                            text: _f('Number of Workspaces')});
        layout.attach(label, 0, 0, 1, 1);

        let entry = new St.Entry({
                            style_class: 'workspace-dialog-entry',
                            can_focus: true});

        this._workspaceEntry = entry.clutter_text;
        layout.attach(entry, 1, 0, 1, 1);
        this.setInitialKeyFocus(this._workspaceEntry);

        label = new St.Label({
                        style_class: 'workspace-dialog-label',
                        y_align: Clutter.ActorAlign.CENTER,
                        text: _f('Rows in workspace switcher')});
        layout.attach(label, 0, 1, 1, 1);

        entry = new St.Entry({
                        style_class: 'workspace-dialog-entry',
                        can_focus: true});

        this._rowEntry = entry.clutter_text;
        layout.attach(entry, 1, 1, 1, 1);

        label = new St.Label({
                        style_class: 'workspace-dialog-label',
                        y_align: Clutter.ActorAlign.CENTER,
                        text: _f('Dynamic workspaces')});
        layout.attach(label, 0, 2, 1, 1);

        this._dynamicWorkspaces = new DynamicWorkspacesSwitch();
        layout.attach(this._dynamicWorkspaces.actor, 1, 2, 1, 1);

        label = new St.Label({
                        style_class: 'workspace-dialog-label',
                        y_align: Clutter.ActorAlign.CENTER,
                        text: _f('Enable panel')});
        layout.attach(label, 0, 3, 1, 1);

        this._enablePanel = new EnablePanelSwitch(this);
        layout.attach(this._enablePanel.actor, 1, 3, 1, 1);

        label = new St.Label({
                        style_class: 'workspace-dialog-label',
                        y_align: Clutter.ActorAlign.CENTER,
                        text: _f('Panel visible in workspace')});
        layout.attach(label, 0, 4, 2, 1);

        let cblayout = new Clutter.GridLayout();
        let cbtable = new St.Widget({
                        reactive: true,
                        layout_manager: cblayout,
                        x_align: Clutter.ActorAlign.CENTER,
                        styleClass: 'workspace-dialog-grid'});
        cblayout.hookup_style(cbtable);

        let ncols = get_ncols();
        let num_ws = this.wm_settings.get_int(SETTINGS_NUM_WORKSPACES);
        this.cb = [];
        for ( let r=0; r<nrows; ++r ) {
            for ( let c=0; c<ncols; ++c ) {
                let i = r*ncols + c;
                if ( i < num_ws ) {
                    this.cb[i] = new CheckBox.CheckBox();
                    this.cb[i].checked = show_panel[i];
                    cblayout.attach(this.cb[i], c, r, 1, 1);
                }
            }
        }
        layout.attach(cbtable, 0, 5, 2, 1);

        let buttons = [{ action: this.close.bind(this),
                         label:  _('Cancel'),
                         key:    Clutter.KEY_Escape},
                       { action: () => {
                                    this._updateValues();
                                    this.close();
                                },
                         label:  _('OK'),
                         default: true }];

        this.setButtons(buttons);
    }

    open() {
        let num_ws = this.wm_settings.get_int(SETTINGS_NUM_WORKSPACES);
        this._workspaceEntry.set_text(''+num_ws);
        this._rowEntry.set_text(''+nrows);
        this._dynamicWorkspaces.updateState();

        super.open(global.get_current_time());
    }

    close() {
        super.close(global.get_current_time());
    }

    _updateValues() {
        let settings = ExtensionUtils.getSettings();
        let changed = false;
        for ( let i=0; i<this.cb.length; ++i ) {
            if ( show_panel[i] != this.cb[i].checked ) {
                show_panel[i] = this.cb[i].checked;
                changed = true;
            }
        }

        if ( changed ) {
            let value = GLib.Variant.new('ab', show_panel);
            settings.set_value(SETTINGS_SHOW_PANEL, value);
        }

        let num = parseInt(this._workspaceEntry.get_text());
        if ( !isNaN(num) && num >= 2 && num <= 32 ) {
            this.wm_settings.set_int(SETTINGS_NUM_WORKSPACES, num);
        }

        let rows = parseInt(this._rowEntry.get_text());
        if ( !isNaN(rows) && rows > 0 && rows < 6 && rows != nrows ) {
            if ( rows != nrows ) {
                nrows = rows;
                settings.set_int(SETTINGS_NUM_ROWS, nrows);
            }
        }
    }
});

const WorkspaceButton =
class WorkspaceButton extends TooltipChild {
    constructor(index) {
        super();

        this.actor = new St.Button({ name: 'workspaceButton',
                                 style_class: 'workspace-button',
                                 reactive: true });
        this.actor.connect('clicked', this._onClicked.bind(this));
        this.actor.connect('destroy', this._onDestroy.bind(this));
        if ( index < global.workspace_manager.n_workspaces ) {
            let ws = global.workspace_manager.get_workspace_by_index(index);
            this._ws = ws;
            this._windowAddedId = ws.connect('window-added',
                                        this._resetAppearance.bind(this));
            this._windowRemovedId = ws.connect('window-removed',
                                        this._resetAppearance.bind(this));
        } else {
            this._ws = null;
        }

        this.label = new St.Label({
                            x_align: Clutter.ActorAlign.CENTER,
                            y_align: Clutter.ActorAlign.CENTER});
        this.actor.set_child(this.label);

        this.tooltip = new St.Label({ style_class: 'bottom-panel-tooltip'});
        this.tooltip.hide();
        Main.layoutManager.addChrome(this.tooltip);
        this.actor.label_actor = this.tooltip;

        this.setIndex(index);
    }

    _onClicked() {
        if ( this.index >= 0 &&
                this.index < global.workspace_manager.n_workspaces ) {
            let metaWorkspace = global.workspace_manager.get_workspace_by_index(this.index);
            metaWorkspace.activate(global.get_current_time());
        }

        return true;
    }

    _onDestroy() {
        this.tooltip.destroy();
        this._ws.disconnect(this._windowAddedId);
        this._ws.disconnect(this._windowRemovedId);
    }

    setIndex(index) {
        if ( index < 0 || index >= global.workspace_manager.n_workspaces ) {
            return;
        }
        this.index = index;
        this._ws = global.workspace_manager.get_workspace_by_index(index);
        return this._resetAppearance();
    }

    _resetAppearance() {
        let index = this.index;
        if (this._ws === null) {
            this.actor.remove_style_pseudo_class('has-windows');
        } else {
            let windows = this._ws.list_windows().filter(function(metaWindow) {
                return metaWindow.is_on_primary_monitor() &&
                   metaWindow.showing_on_its_workspace() &&
                   metaWindow.get_window_type() != Meta.WindowType.DESKTOP;
            });
            if ( windows.length > 0 ) {
                this.actor.add_style_pseudo_class('has-windows');
            } else {
                this.actor.remove_style_pseudo_class('has-windows');
            }
        }

        let active = global.workspace_manager.get_active_workspace_index();
        let tt_text = '';

        if ( index == active ) {
            this.label.set_text('-' + (index+1).toString() + '-');
            this.actor.add_style_pseudo_class('outlined');
            tt_text = Meta.prefs_get_workspace_name(index);
        }
        else if (index >= 0 && index < global.workspace_manager.n_workspaces) {
            this.label.set_text((index+1).toString());
            this.actor.remove_style_pseudo_class('outlined');
            tt_text = Meta.prefs_get_workspace_name(index);
        }
        else {
            this.label.set_text('');
            this.actor.remove_style_pseudo_class('outlined');
        }
        this.tooltip.set_text(tt_text);
        this.index = index;

        if (index % 4 == 0) {
            this.actor.add_style_pseudo_class('starts-section');
        } else {
            this.actor.remove_style_pseudo_class('starts-section');
        }

        let ws_name = Meta.prefs_get_workspace_name(index);
        this.label.set_text(ws_name);

        if ( index == active ) {
            this.actor.add_style_pseudo_class('is-active');
        } else {
            this.actor.remove_style_pseudo_class('is-active');
        }
        this.tooltip.set_text(ws_name);
    }
};

const WorkspaceSwitcher =
class WorkspaceSwitcher extends TooltipContainer {
    constructor() {
        super();

        this.actor = new St.BoxLayout({ name: 'workspaceSwitcher',
                                        style_class: 'workspace-switcher',
                                        reactive: true });
        this.actor.connect('button-release-event', this._showDialog);
        this.actor.connect('scroll-event', this._onScroll);
        this.actor.connect('destroy', this._onDestroy.bind(this));
        this.actor._delegate = this;
        this.button = [];
        this._createButtons();

        this._onNWorkspacesId = global.workspace_manager.connect(
                                'notify::n-workspaces',
                                this._createButtons.bind(this));
        this._onSwitchWorkspaceId = global.window_manager.connect(
                                'switch-workspace',
                                this._updateButtons.bind(this));
    }

    _createButtons() {
        this.actor.destroy_all_children();
        this.button = [];

        this.row_indicator = null;
        if ( nrows > 1 ) {
            this.row_indicator = new St.DrawingArea({ reactive: true,
                                    style_class: 'workspace-row-indicator' });
            this.row_indicator.connect('repaint', this._draw.bind(this));
            this.row_indicator.connect('button-press-event',
                                    this._rowButtonPress.bind(this));
            this.row_indicator.connect('scroll-event',
                                    this._rowScroll.bind(this));
            this.actor.add(this.row_indicator);
        }

        let ncols = get_ncols();
        let active = global.workspace_manager.get_active_workspace_index();
        let row = Math.floor(active/ncols);

        let index = row*ncols;
        for ( let i=0; i<ncols; ++i ) {
            let btn = new WorkspaceButton(index++);
            this.actor.add(btn.actor);
            btn.actor.connect('notify::hover', () => this._onHover(btn));
            this.button[i] = btn;
        }

        global.workspace_manager.override_workspace_layout(Meta.DisplayCorner.TOPLEFT,
                false, nrows, ncols);
    }

    _updateButtons() {
        let ncols = get_ncols();
        let active = global.workspace_manager.get_active_workspace_index();
        let row = Math.floor(active/ncols);

        let index = row*ncols;
        for ( let i=0; i<this.button.length; ++i ) {
            this.button[i].setIndex(index++);
        }

        if ( this.row_indicator ) {
            this.row_indicator.queue_repaint();
        }
    }

    _showDialog(actor, event) {
        if ( event.get_button() == 3 ) {
            let _workspaceDialog = new WorkspaceDialog();
            _workspaceDialog.open();
            return true;
        }
        return false;
    }

    _onScroll(actor, event) {
        let direction = event.get_scroll_direction();
        let ncols = get_ncols();
        let active = global.workspace_manager.get_active_workspace_index();
        let index = global.workspace_manager.n_workspaces;

        if ( direction == Clutter.ScrollDirection.UP ) {
            if ( active%ncols > 0 ) {
                index = active-1;
            }
        }
        if ( direction == Clutter.ScrollDirection.DOWN ) {
            if ( active < global.workspace_manager.n_workspaces-1 &&
                         active%ncols != ncols-1 ) {
                index = active+1;
            }
        }

        if ( index >= 0 && index < global.workspace_manager.n_workspaces ) {
            let metaWorkspace = global.workspace_manager.get_workspace_by_index(index);
            metaWorkspace.activate(global.get_current_time());
        }

        return true;
    }

    _rowButtonPress(actor, event) {
        if ( event.get_button() != 1 ) {
            return false;
        }

        let ncols = get_ncols();
        let active = global.workspace_manager.get_active_workspace_index();
        let row = Math.floor(active/ncols);

        let [x, y] = event.get_coords();
        let [wx, wy] = actor.get_transformed_position();
        let [w, h] = actor.get_size();
        y -= wy;

        let new_row = Math.floor(nrows*y/h);
        let index = global.workspace_manager.n_workspaces;
        if ( new_row != row ) {
            index = new_row*ncols + active%ncols;
        }

        if ( index >= 0 && index < global.workspace_manager.n_workspaces ) {
            let metaWorkspace = global.workspace_manager.get_workspace_by_index(index);
            metaWorkspace.activate(global.get_current_time());
        }

        return true;
    }

    _rowScroll(actor, event) {
        let direction = event.get_scroll_direction();
        let ncols = get_ncols();
        let active = global.workspace_manager.get_active_workspace_index();
        let row = Math.floor(active/ncols);

        let index = global.workspace_manager.n_workspaces;
        if ( direction == Clutter.ScrollDirection.DOWN ) {
            index = (row+1)*ncols + active%ncols;
        }
        if ( direction == Clutter.ScrollDirection.UP ) {
            index = (row-1)*ncols + active%ncols;
        }

        if ( index >= 0 && index < global.workspace_manager.n_workspaces ) {
            let metaWorkspace = global.workspace_manager.get_workspace_by_index(index);
            metaWorkspace.activate(global.get_current_time());
        }

        return true;
    }

    _draw(area) {
        let [width, height] = area.get_surface_size();
        let themeNode = this.row_indicator.get_theme_node();
        let cr = area.get_context();

        let active_color = themeNode.get_color('-active-color');
        let inactive_color = themeNode.get_color('-inactive-color');

        let ncols = get_ncols();
        let active = global.workspace_manager.get_active_workspace_index();
        let row = Math.floor(active/ncols);

        for ( let i=0; i<nrows; ++i ) {
            let y = (i+1)*height/(nrows+1);
            cr.moveTo(0, y);
            cr.lineTo(width, y);
            let color = row == i ? active_color : inactive_color;
            Clutter.cairo_set_source_color(cr, color);
            cr.setLineWidth(2.0);
            cr.stroke();
        }
    }

    _onDestroy() {
        global.workspace_manager.disconnect(this._onNWorkspacesId);
        global.window_manager.disconnect(this._onSwitchWorkspaceId);
    }
};

const BottomPanel =
class BottomPanel {
    constructor() {
        this._settings = ExtensionUtils.getSettings();

        let rows = this._settings.get_int(SETTINGS_NUM_ROWS);
        if ( !isNaN(rows) && rows > 0 && rows < 6 ) {
            nrows = rows;
        }

        enable_panel = this._settings.get_boolean(SETTINGS_ENABLE_PANEL);

        let b = this._settings.get_value(SETTINGS_SHOW_PANEL).deep_unpack();
        if ( b.length > 1 ) {
            for ( let i=0; i<b.length; ++i ) {
                show_panel[i] = b[i];
            }
        }

        this.actor = new St.BoxLayout({ style_class: 'bottom-panel',
                                        name: 'bottomPanel',
                                        reactive: true });
        this.actor._delegate = this;

        let windowList = new WindowList();
        this.actor.add(windowList.actor);

        this.workspaceSwitcher = new WorkspaceSwitcher();
        this.actor.add(this.workspaceSwitcher.actor);

        Main.layoutManager.addChrome(this.actor, { affectsStruts: true,
                                                   trackFullscreen: true });
        Main.uiGroup.set_child_above_sibling(this.actor,
                Main.layoutManager.panelBox);

        this.actor.connect('style-changed', this.relayout.bind(this));
        this.actor.connect('destroy', this._onDestroy.bind(this));

        let monitorManager = Meta.MonitorManager.get();
        this._monitorsChangedId = monitorManager.connect('monitors-changed',
                            this.relayout.bind(this));
        this._sessionUpdatedId = Main.sessionMode.connect('updated',
                            this._sessionUpdated.bind(this));
        this._onSwitchWorkspaceId = global.window_manager.connect(
                            'switch-workspace',
                            this.relayout.bind(this));
        this._numRowsChangedId = this._settings.connect(
                            'changed::'+SETTINGS_NUM_ROWS,
                            this._numRowsChanged.bind(this));
        this._enablePanelChangedId = this._settings.connect(
                            'changed::'+SETTINGS_ENABLE_PANEL,
                            this._enablePanelChanged.bind(this));
        this._showPanelChangedId = this._settings.connect(
                            'changed::'+SETTINGS_SHOW_PANEL,
                            this._showPanelChanged.bind(this));
    }

    relayout() {
        let bottom = Main.layoutManager.bottomMonitor;

        let h = this.actor.get_theme_node().get_height();
        let active = global.workspace_manager.get_active_workspace_index();
        if ( !enable_panel || !show_panel[active] ) h = -h;
        this.actor.set_position(bottom.x, bottom.y+bottom.height-h);
        this.actor.set_size(bottom.width, -1);
    }

    _sessionUpdated() {
        this.actor.visible = Main.sessionMode.hasWorkspaces;
    }

    _numRowsChanged() {
        let rows = this._settings.get_int(SETTINGS_NUM_ROWS);
        if ( !isNaN(rows) && rows > 0 && rows < 6 ) {
            nrows = rows;
            this.workspaceSwitcher._createButtons();
        }
    }

    _enablePanelChanged() {
        enable_panel = this._settings.get_boolean(SETTINGS_ENABLE_PANEL);
        this.relayout();
    }

    _showPanelChanged() {
        let b = this._settings.get_value(SETTINGS_SHOW_PANEL).deep_unpack();
        if ( b.length > 1 ) {
            for ( let i=0; i<b.length; ++i ) {
                show_panel[i] = b[i];
            }
        }
        this.relayout();
    }

    _onDestroy() {
        let monitorManager = Meta.MonitorManager.get();
        monitorManager.disconnect(this._monitorsChangedId);
        global.window_manager.disconnect(this._onSwitchWorkspaceId);
        Main.sessionMode.disconnect(this._sessionUpdatedId);

        if ( this._numRowsChangedId != 0 ) {
            this._settings.disconnect(this._numRowsChangedId);
            this._numRowsChangedId = 0;
        }

        if ( this._enablePanelChangedId != 0 ) {
            this._settings.disconnect(this._enablePanelChangedId);
            this._enablePanelChangedId = 0;
        }
        if ( this._showPanelChangedId != 0 ) {
            this._settings.disconnect(this._showPanelChangedId);
            this._showPanelChangedId = 0;
        }
    }
};

const FRIPPERY_TIMEOUT = 400;

var FripperySwitcherPopupList = GObject.registerClass(
class FripperySwitcherPopupList extends WorkspaceSwitcherPopup.WorkspaceSwitcherPopupList {
    _init() {
        super._init();
        this._itemSpacing = 6;
    }

    vfunc_get_preferred_height(forWidth) {
        let children = this.get_children();
        let workArea = Main.layoutManager.getWorkAreaForMonitor(
                        Main.layoutManager.primaryIndex);
        let themeNode = this.get_theme_node();

        let availHeight = workArea.height;
        availHeight -= 2 * themeNode.get_vertical_padding();

        let height = 0;
        for (let i = 0; i < children.length; i++) {
            let [childMinHeight, childNaturalHeight] =
                    children[i].get_preferred_height(-1);
            height = Math.max(height, childNaturalHeight);
        }

        height = nrows * height;

        let spacing = this._itemSpacing * (nrows - 1);
        height += spacing;
        height = Math.min(height, availHeight);

        this._childHeight = (height - spacing) / nrows;

        return themeNode.adjust_preferred_height(height, height);
    }

    vfunc_get_preferred_width(forHeight) {
        let children = this.get_children();
        let workArea = Main.layoutManager.getWorkAreaForMonitor(
                        Main.layoutManager.primaryIndex);
        let themeNode = this.get_theme_node();

        let availWidth = workArea.width;
        availWidth -= 2 * themeNode.get_horizontal_padding();

        let ncols = get_ncols();
        let height = 0;
        for (let i = 0; i < children.length; i++) {
            let [childMinHeight, childNaturalHeight] =
                    children[i].get_preferred_height(-1);
            height = Math.max(height, childNaturalHeight);
        }

        let width = ncols * height * workArea.width/workArea.height;

        let spacing = this._itemSpacing * (ncols - 1);
        width += spacing;
        width = Math.min(width, availWidth);

        this._childWidth = (width - spacing) / ncols;

        return [width, width];
    }

    vfunc_allocate(box) {
        this.set_allocation(box);

        let themeNode = this.get_theme_node();
        box = themeNode.get_content_box(box);

        let childBox = new Clutter.ActorBox();

        let ncols = get_ncols();
        let children = this.get_children();

        for ( let ir=0; ir<nrows; ++ir ) {
            for ( let ic=0; ic<ncols; ++ic ) {
                let i = ncols*ir + ic;
                if (!children[i])
                    continue;
                let x = box.x1 + ic * (this._childWidth + this._itemSpacing);
                childBox.x1 = x;
                childBox.x2 = x + this._childWidth;
                let y = box.y1 + ir * (this._childHeight + this._itemSpacing);
                childBox.y1 = y;
                childBox.y2 = y + this._childHeight;
                children[i].allocate(childBox);
            }
        }
    }
});

const FripperySwitcherPopup = GObject.registerClass(
class FripperySwitcherPopup extends WorkspaceSwitcherPopup.WorkspaceSwitcherPopup {
    _init() {
        super._init();
        this._container.destroy_all_children();
        this._list = new FripperySwitcherPopupList();
        this._container.add_child(this._list);
    }

    _redisplay() {
        this._list.destroy_all_children();

        for (let i = 0; i < global.workspace_manager.n_workspaces; i++) {
            let indicator = null;

           if (i == this._activeWorkspaceIndex && this._direction == Meta.MotionDirection.LEFT)
               indicator = new St.Bin({ style_class: 'ws-switcher-active-left' });
           else if (i == this._activeWorkspaceIndex && this._direction == Meta.MotionDirection.RIGHT)
               indicator = new St.Bin({ style_class: 'ws-switcher-active-right' });
           else if (i == this._activeWorkspaceIndex && this._direction == Meta.MotionDirection.UP)
               indicator = new St.Bin({ style_class: 'ws-switcher-active-up' });
           else if(i == this._activeWorkspaceIndex && this._direction == Meta.MotionDirection.DOWN)
               indicator = new St.Bin({ style_class: 'ws-switcher-active-down' });
           else
               indicator = new St.Bin({ style_class: 'ws-switcher-box' });

           this._list.add_actor(indicator);
        }

        let workArea = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
        let [containerMinHeight, containerNatHeight] = this._container.get_preferred_height(global.screen_width);
        let [containerMinWidth, containerNatWidth] = this._container.get_preferred_width(containerNatHeight);
        this._container.x = workArea.x + Math.floor((workArea.width - containerNatWidth) / 2);
        this._container.y = workArea.y + Math.floor((workArea.height - containerNatHeight) / 2);
    }

    display(direction, activeWorkspaceIndex) {
        this._direction = direction;
        this._activeWorkspaceIndex = activeWorkspaceIndex;

        this._redisplay();
        if (this._timeoutId != 0)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
                            FRIPPERY_TIMEOUT, this._onTimeout.bind(this));
        GLib.Source.set_name_by_id(this._timeoutId, '[gnome-shell] this._onTimeout');
        this._show();
    }
});

let myShowWorkspaceSwitcher, origShowWorkspaceSwitcher;

const BottomPanelExtension =
class BottomPanelExtension {
    constructor() {
        ExtensionUtils.initTranslations();

        this._bottomPanel = null;

        this._origShowWorkspaceSwitcher =
            WindowManager.WindowManager.prototype._showWorkspaceSwitcher;

        this._myShowWorkspaceSwitcher =
            function(display, window, binding) {
            let workspaceManager = display.get_workspace_manager();

            if (!Main.sessionMode.hasWorkspaces)
                return;

            if (workspaceManager.n_workspaces == 1)
                return;

            let [action,,,target] = binding.get_name().split('-');
            let newWs;
            let direction;

            if (isNaN(target)) {
                direction = Meta.MotionDirection[target.toUpperCase()];
                newWs = workspaceManager.get_active_workspace().get_neighbor(direction);
            } else if (target > 0) {
                target--;
                newWs = workspaceManager.get_workspace_by_index(target);

                // FIXME add proper support for switching to numbered workspace
                if (workspaceManager.get_active_workspace().index() > target)
                    direction = Meta.MotionDirection.UP;
                else
                    direction = Meta.MotionDirection.DOWN;
            }

            if (!newWs)
                return;

            if (action == 'switch')
                this.actionMoveWorkspace(newWs);
            else
                this.actionMoveWindow(window, newWs);

            if (!Main.overview.visible) {
                if (this._workspaceSwitcherPopup == null) {
                    this._workspaceSwitcherPopup = new FripperySwitcherPopup();
                    this._workspaceSwitcherPopup.connect('destroy',
                        () => this._workspaceSwitcherPopup = null);
                }
                this._workspaceSwitcherPopup.display(direction, newWs.index());
            }
        };

        WindowManager.WindowManager.prototype._reset = function() {
            Meta.keybindings_set_custom_handler('switch-to-workspace-left',
                        this._showWorkspaceSwitcher.bind(this));
            Meta.keybindings_set_custom_handler('switch-to-workspace-right',
                        this._showWorkspaceSwitcher.bind(this));
            Meta.keybindings_set_custom_handler('switch-to-workspace-up',
                        this._showWorkspaceSwitcher.bind(this));
            Meta.keybindings_set_custom_handler('switch-to-workspace-down',
                        this._showWorkspaceSwitcher.bind(this));
            Meta.keybindings_set_custom_handler('move-to-workspace-left',
                        this._showWorkspaceSwitcher.bind(this));
            Meta.keybindings_set_custom_handler('move-to-workspace-right',
                        this._showWorkspaceSwitcher.bind(this));
            Meta.keybindings_set_custom_handler('move-to-workspace-up',
                        this._showWorkspaceSwitcher.bind(this));
            Meta.keybindings_set_custom_handler('move-to-workspace-down',
                        this._showWorkspaceSwitcher.bind(this));

            this._workspaceSwitcherPopup = null;
        };
    }

    enable() {
        if ( Main.sessionMode.currentMode == 'classic' ) {
            log('Frippery Bottom Panel does not work in Classic mode');
            return;
        }

        WindowManager.WindowManager.prototype._showWorkspaceSwitcher =
            this._myShowWorkspaceSwitcher;

        Main.wm._reset();

        this._bottomPanel = new BottomPanel();
        this._bottomPanel.relayout();
    }

    disable() {
        if ( Main.sessionMode.currentMode == 'classic' ) {
            return;
        }

        global.workspace_manager.override_workspace_layout(Meta.DisplayCorner.TOPLEFT,
                false, -1, 1);

        WindowManager.WindowManager.prototype._showWorkspaceSwitcher =
            this._origShowWorkspaceSwitcher;

        Main.wm._reset();

        if (this._bottomPanel) {
            this._bottomPanel.actor.destroy();
            this._bottomPanel = null;
        }
    }
};

function init() {
    return new BottomPanelExtension();
}
