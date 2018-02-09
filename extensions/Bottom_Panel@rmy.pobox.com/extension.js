// Copyright (C) 2011-2017 R M Yorston
// Licence: GPLv2+

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Pango = imports.gi.Pango;
const Shell = imports.gi.Shell;
const Signals = imports.signals;
const St = imports.gi.St;

const CheckBox = imports.ui.checkBox;
const Main = imports.ui.main;
const ModalDialog = imports.ui.modalDialog;
const PopupMenu = imports.ui.popupMenu;
const Tweener = imports.ui.tweener;
const WindowManager = imports.ui.windowManager;
const WorkspaceSwitcherPopup = imports.ui.workspaceSwitcherPopup;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

const _f = imports.gettext.domain('frippery-bottom-panel').gettext;

const BOTTOM_PANEL_TOOLTIP_SHOW_TIME = 0.15;
const BOTTOM_PANEL_TOOLTIP_HIDE_TIME = 0.1;
const BOTTOM_PANEL_HOVER_TIMEOUT = 300;

const OVERRIDES_SCHEMA = 'org.gnome.shell.overrides';

const SETTINGS_NUM_ROWS = 'num-rows';
const SETTINGS_SHOW_PANEL = 'show-panel';

let show_panel = [];

/*
 * This is a base class for containers that manage the tooltips of their
 * children.  Each child actor with a tooltip should be connected to
 * the container hover handler:
 *
 *    item.actor.connect('notify::hover', Lang.bind(this, function() {
 *                          this._onHover(item); }));
 *
 */
const TooltipContainer = new Lang.Class({
    Name: 'TooltipContainer',

    _init: function() {
        this._showTooltipTimeoutId = 0;
        this._resetHoverTimeoutId = 0;
        this._tooltipShowing = false;
    },

    _onHover: function(item) {
        if ( item.actor.hover ) {
            if (this._showTooltipTimeoutId == 0) {
                let timeout = this._tooltipShowing ?
                                0 : BOTTOM_PANEL_HOVER_TIMEOUT;
                this._showTooltipTimeoutId = Mainloop.timeout_add(timeout,
                    Lang.bind(this, function() {
                        this._tooltipShowing = true;
                        item.showTooltip(this);
                        this._showTooltipTimeoutId = 0;
                        return GLib.SOURCE_REMOVE;
                    }));
                if (this._resetHoverTimeoutId > 0) {
                    Mainloop.source_remove(this._resetHoverTimeoutId);
                    this._resetHoverTimeoutId = 0;
                }
            }
        } else {
            if (this._showTooltipTimeoutId > 0) {
                Mainloop.source_remove(this._showTooltipTimeoutId);
                this._showTooltipTimeoutId = 0;
            }
            item.hideTooltip();
            if (this._tooltipShowing) {
                this._resetHoverTimeoutId = Mainloop.timeout_add(
                    BOTTOM_PANEL_HOVER_TIMEOUT,
                    Lang.bind(this, function() {
                        this._tooltipShowing = false;
                        this._resetHoverTimeoutId = 0;
                        return GLib.SOURCE_REMOVE;
                    }));
            }
        }
    }
});

/*
 * This is a base class for child items that have a tooltip and which allow
 * the hover handler in the parent container class to show/hide the tooltip.
 */
const TooltipChild = new Lang.Class({
    Name: 'TooltipChild',

    _init: function() {
    },

    showTooltip: function(container) {
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
        Tweener.addTween(this.tooltip,
                     { opacity: 255,
                       time: BOTTOM_PANEL_TOOLTIP_SHOW_TIME,
                       transition: 'easeOutQuad',
                     });
    },

    hideTooltip: function () {
        this.tooltip.opacity = 255;

        Tweener.addTween(this.tooltip,
                     { opacity: 0,
                       time: BOTTOM_PANEL_TOOLTIP_HIDE_TIME,
                       transition: 'easeOutQuad',
                       onComplete: Lang.bind(this, function() {
                           this.tooltip.hide();
                       })
                     });
    }
});

const MAX_BOTH = Meta.MaximizeFlags.HORIZONTAL | Meta.MaximizeFlags.VERTICAL;

const WindowListItemMenu = new Lang.Class({
    Name: 'WindowListItemMenu',
    Extends: PopupMenu.PopupMenu,

    _init: function(metaWindow, actor) {
        this.parent(actor, 0.0, St.Side.BOTTOM, 0);

        Main.uiGroup.add_actor(this.actor);
        this.actor.hide();

        this.metaWindow = metaWindow;

        this.connect('open-state-changed', Lang.bind(this, this._onToggled));

        let text = metaWindow.minimized ? _f('Unminimize') : _('Minimize');
        let item = new PopupMenu.PopupMenuItem(text);
        item.connect('activate', Lang.bind(this, this._onMinimizeWindowActivate));
        this.addMenuItem(item);
        this.itemMinimizeWindow = item;

        text = metaWindow.get_maximized == MAX_BOTH ?
                _('Unmaximize') : _('Maximize');
        item = new PopupMenu.PopupMenuItem(text);
        item.connect('activate', Lang.bind(this, this._onMaximizeWindowActivate));
        this.addMenuItem(item);
        this.itemMaximizeWindow = item;

        item = new PopupMenu.PopupMenuItem(_('Always on Top'));
        item.connect('activate', Lang.bind(this, this._onOnTopWindowToggle));
        if ( metaWindow.above ) {
            item.setOrnament(PopupMenu.Ornament.DOT);
        }
        this.addMenuItem(item);
        this.itemOnTopWindow = item;

        item = new PopupMenu.PopupMenuItem(_('Always on Visible Workspace'));
        item.connect('activate', Lang.bind(this, this._onStickyWindowToggle));
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
            item.connect('activate', Lang.bind(this,
                            this._onMoveWindowActivate));
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
        item.connect('activate', Lang.bind(this, this._onCloseWindowActivate));
        this.addMenuItem(item);
    },

    _buildWorkspaceSubMenu: function(submenu) {
        for ( let j=0; j<global.screen.n_workspaces; ++j ) {
            let active = global.screen.get_active_workspace_index();
            let item = new PopupMenu.PopupMenuItem(
                            Meta.prefs_get_workspace_name(j));
            item.index = j;
            item.connect('activate', Lang.bind(this, this._onMoveToActivate));
            item.setSensitive(j != active);
            submenu.addMenuItem(item, j);
        }
    },

    _onToggled: function(actor, state) {
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

        let ws1 = global.screen.get_active_workspace();

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
                global.screen.n_workspaces ) {
            this.workspaceSubMenu.removeAll();
            this._buildWorkspaceSubMenu(this.workspaceSubMenu);
        }
    },

    _onMinimizeWindowActivate: function(actor, event) {
        if ( this.metaWindow.minimized ) {
            this.metaWindow.activate(global.get_current_time());
            this.itemMinimizeWindow.label.set_text(_('Minimize'));
        }
        else {
            this.metaWindow.minimize(global.get_current_time());
            this.itemMinimizeWindow.label.set_text(_f('Unminimize'));
        }
    },

    _onMaximizeWindowActivate: function(actor, event) {
        if ( this.metaWindow.get_maximized() == MAX_BOTH ) {
            this.metaWindow.unmaximize(MAX_BOTH);
            this.itemMaximizeWindow.label.set_text(_('Maximize'));
        }
        else {
            this.metaWindow.maximize(MAX_BOTH);
            this.itemMaximizeWindow.label.set_text(_('Unmaximize'));
        }
    },

    _onOnTopWindowToggle: function(item, event) {
        if ( this.metaWindow.is_above() ) {
            item.setOrnament(PopupMenu.Ornament.NONE);
            this.metaWindow.unmake_above();
        }
        else {
            item.setOrnament(PopupMenu.Ornament.DOT);
            this.metaWindow.make_above();
        }
    },

    _onStickyWindowToggle: function(item, event) {
        if ( this.metaWindow.is_on_all_workspaces() ) {
            item.setOrnament(PopupMenu.Ornament.NONE);
            this.metaWindow.unstick();
        }
        else {
            item.setOrnament(PopupMenu.Ornament.DOT);
            this.metaWindow.stick();
        }
    },

    _onMoveWindowActivate: function(item, event) {
        let ws1 = global.screen.get_active_workspace();
        let ws2 = ws1.get_neighbor(item.direction);
        if ( ws2 && ws1 != ws2 ) {
            this.metaWindow.change_workspace(ws2);
        }
    },

    _onMoveToActivate: function(item, event) {
        let ws1 = global.screen.get_active_workspace();
        let ws2 = global.screen.get_workspace_by_index(item.index);
        if ( ws2 && ws1 != ws2 ) {
            this.metaWindow.change_workspace(ws2);
        }
    },

    _onCloseWindowActivate: function(actor, event) {
        this.metaWindow.delete(global.get_current_time());
    }
});

const WindowListItem = new Lang.Class({
    Name: 'WindowListItem',
    Extends: TooltipChild,

    _init: function(app, metaWindow) {
        this.parent();

        this.actor = new St.Bin({ reactive: true,
                                  track_hover: true,
                                  can_focus: true });
        this.actor._delegate = this;

        let title = metaWindow.title ? metaWindow.title : ' ';

        this.tooltip = new St.Label({ style_class: 'bottom-panel-tooltip'});
        this.tooltip.set_text(title);
        this.tooltip.hide();
        Main.layoutManager.addChrome(this.tooltip);
        this.actor.label_actor = this.tooltip;

        this._itemBox = new St.BoxLayout({style_class: 'window-list-item-box'});
        this.metaWindow = metaWindow;
        this.actor.add_actor(this._itemBox);

        this.icon = app ? app.create_icon_texture(16) :
                          new St.Icon({ icon_name: 'icon-missing',
                                        icon_size: 16 });

        if ( !metaWindow.showing_on_its_workspace() ) {
            title = '[' + title + ']';
        }

        this.label = new St.Label({ style_class: 'window-list-item-label',
                                    text: title });
        this.label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._itemBox.add(this.icon, { x_fill: false, y_fill: false });
        this._itemBox.add(this.label, { x_fill: true, y_fill: false });

        this.rightClickMenu = new WindowListItemMenu(metaWindow, this.actor);

        this._notifyTitleId = metaWindow.connect('notify::title',
                                    Lang.bind(this, this._onTitleChanged));
        this._notifyMinimizedId = metaWindow.connect('notify::minimized',
                                    Lang.bind(this, this._onMinimizedChanged));
        this._notifyFocusId =
            global.display.connect('notify::focus-window',
                                    Lang.bind(this, this._onFocus));

        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
        this.actor.connect('button-press-event',
                                    Lang.bind(this, this._onButtonPress));
        this.actor.connect('allocation-changed',
                                    Lang.bind(this, this._updateIconGeometry));

        this._onFocus();
    },

    _onTitleChanged: function() {
        let title = this.metaWindow.title;
        this.tooltip.set_text(title);
        if ( this.metaWindow.minimized ) {
            title = '[' + title + ']';
        }
        this.label.set_text(title);
    },

    _onMinimizedChanged: function() {
        if ( this.metaWindow.minimized ) {
            this.icon.opacity = 127;
            this.label.text = '[' + this.metaWindow.title + ']';
        }
        else {
            this.icon.opacity = 255;
            this.label.text = this.metaWindow.title;
        }
    },

    _onDestroy: function() {
        this.metaWindow.disconnect(this._notifyTitleId);
        this.metaWindow.disconnect(this._notifyMinimizedId);
        global.display.disconnect(this._notifyFocusId);
        this.tooltip.destroy();
        this.rightClickMenu.destroy();
    },

    _onButtonPress: function(actor, event) {
        let button = event.get_button();
        if ( this.rightClickMenu.isOpen ) {
            this.rightClickMenu.close();
        }
        else if ( button == 1 ) {
            if ( this.metaWindow.has_focus() ) {
                this.metaWindow.minimize(global.get_current_time());
            }
            else {
                this.metaWindow.activate(global.get_current_time());
            }
        }
        else if ( button == 3 ) {
            this.hideTooltip();
            this.rightClickMenu.open();
        }
    },

    _onFocus: function() {
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
    },

    _updateIconGeometry: function() {
        let rect = new Meta.Rectangle();

        [rect.x, rect.y] = this.actor.get_transformed_position();
        [rect.width, rect.height] = this.actor.get_transformed_size();

        this.metaWindow.set_icon_geometry(rect);
    }
});

const WindowList = new Lang.Class({
    Name: 'WindowList',
    Extends: TooltipContainer,

    _init: function() {
        this.parent();

        this.actor = new St.BoxLayout({ name: 'windowList',
                                        style_class: 'window-list-box' });
        this.actor._delegate = this;
        this._windows = [];

        this._onSwitchWorkspaceId = global.window_manager.connect(
                                        'switch-workspace',
                                        Lang.bind(this, this._refreshItems));

        this._workspaces = [];
        this._changeWorkspaces();

        this._onNWorkspacesId = global.screen.connect('notify::n-workspaces',
                                Lang.bind(this, this._changeWorkspaces));

        this._menuManager = new PopupMenu.PopupMenuManager(this);
        this._refreshItems();

        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
    },

    _onHover: function(item) {
        if ( item.rightClickMenu.isOpen ) {
            item.hideTooltip();
        }
        else {
            this.parent(item);
        }
    },

    _addListItem: function(metaWindow) {
        if ( metaWindow && !metaWindow.skip_taskbar ) {
            let tracker = Shell.WindowTracker.get_default();
            let app = tracker.get_window_app(metaWindow);
            if ( app ) {
                let item = new WindowListItem(app, metaWindow);
                this._windows.push(item);
                this.actor.add(item.actor);
                item.actor.connect('notify::hover',
                        Lang.bind(this, function() {
                            this._onHover(item);
                        }));
                this._menuManager.addMenu(item.rightClickMenu);
            }
        }
    },

    _refreshItems: function() {
        this.actor.destroy_all_children();
        this._windows = [];

        let metaWorkspace = global.screen.get_active_workspace();
        let windows = metaWorkspace.list_windows();
        windows.sort(function(w1, w2) {
            return w1.get_stable_sequence() - w2.get_stable_sequence();
        });

        // Create list items for each window
        for ( let i = 0; i < windows.length; ++i ) {
            this._addListItem(windows[i]);
        }
    },

    _windowAdded: function(metaWorkspace, metaWindow) {
        if ( metaWorkspace.index() != global.screen.get_active_workspace_index() ) {
            return;
        }

        for ( let i=0; i<this._windows.length; ++i ) {
            if ( this._windows[i].metaWindow == metaWindow ) {
                return;
            }
        }

        this._addListItem(metaWindow);
    },

    _windowRemoved: function(metaWorkspace, metaWindow) {
        if ( metaWorkspace.index() != global.screen.get_active_workspace_index() ) {
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
    },

    _changeWorkspaces: function() {
        for ( let i=0; i<this._workspaces.length; ++i ) {
            let ws = this._workspaces[i];
            ws.disconnect(ws._windowAddedId);
            ws.disconnect(ws._windowRemovedId);
        }

        this._workspaces = [];
        for ( let i=0; i<global.screen.n_workspaces; ++i ) {
            let ws = global.screen.get_workspace_by_index(i);
            this._workspaces[i] = ws;
            ws._windowAddedId = ws.connect('window-added',
                                    Lang.bind(this, this._windowAdded));
            ws._windowRemovedId = ws.connect('window-removed',
                                    Lang.bind(this, this._windowRemoved));
            if ( i >= show_panel.length ) {
                show_panel[i] = true;
            }
        }
    },

    _onDestroy: function() {
        for ( let i=0; i<this._workspaces.length; ++i ) {
            let ws = this._workspaces[i];
            ws.disconnect(ws._windowAddedId);
            ws.disconnect(ws._windowRemovedId);
        }

        global.window_manager.disconnect(this._onSwitchWorkspaceId);
        global.screen.disconnect(this._onNWorkspacesId);
    }
});

let nrows = 1;

function get_ncols() {
    let ncols = Math.floor(global.screen.n_workspaces/nrows);
    if ( global.screen.n_workspaces%nrows != 0 )
       ++ncols

    return ncols;
}

const ToggleSwitch = new Lang.Class({
    Name: 'ToggleSwitch',
    Extends: PopupMenu.Switch,

    _init: function(state) {
        this.parent(state);

        this.actor.can_focus = true;
        this.actor.reactive = true;
        this.actor.add_style_class_name("bottom-panel-toggle-switch");

        this.actor.connect('button-release-event',
                Lang.bind(this, this._onButtonReleaseEvent));
        this.actor.connect('key-press-event',
                Lang.bind(this, this._onKeyPressEvent));
        this.actor.connect('key-focus-in',
                Lang.bind(this, this._onKeyFocusIn));
        this.actor.connect('key-focus-out',
                Lang.bind(this, this._onKeyFocusOut));
    },

    _onButtonReleaseEvent: function(actor, event) {
        this.toggle();
        return true;
    },

    _onKeyPressEvent: function(actor, event) {
        let symbol = event.get_key_symbol();

        if (symbol == Clutter.KEY_space || symbol == Clutter.KEY_Return) {
            this.toggle();
            return true;
        }

        return false;
    },

    _onKeyFocusIn: function(actor) {
        actor.add_style_pseudo_class('active');
    },

    _onKeyFocusOut: function(actor) {
        actor.remove_style_pseudo_class('active');
    }
});

const DynamicWorkspacesSwitch = new Lang.Class({
    Name: 'DynamicWorkspacesSwitch',
    Extends: ToggleSwitch,

    _init: function() {
        this._settings = new Gio.Settings({ schema: OVERRIDES_SCHEMA });
        let state = this._settings.get_boolean('dynamic-workspaces');

        this.parent(state);
    },

    updateState: function() {
        this.setToggleState(this._settings.get_boolean('dynamic-workspaces'));
    },

    toggle: function() {
        this.parent();
        this._settings.set_boolean('dynamic-workspaces', this.state);
    }
});

const WorkspaceDialog = new Lang.Class({
    Name: 'WorkspaceDialog',
    Extends: ModalDialog.ModalDialog,

    _init: function() {
        this.parent({ styleClass: 'workspace-dialog' });

        let layout = new Clutter.TableLayout();
        let table = new St.Widget({reactive: true,
                              layout_manager: layout,
                              styleClass: 'workspace-dialog-table'});
        layout.hookup_style(table);
        this.contentLayout.add(table, { y_align: St.Align.START });

        let label = new St.Label(
                        { style_class: 'workspace-dialog-label',
                          text: _f('Number of Workspaces') });
        layout.pack(label, 0, 0);

        let entry = new St.Entry({ style_class: 'workspace-dialog-entry', can_focus: true });

        this._workspaceEntry = entry.clutter_text;
        layout.pack(entry, 1, 0);
        this.setInitialKeyFocus(this._workspaceEntry);

        label = new St.Label({ style_class: 'workspace-dialog-label',
                                   text: _f('Rows in workspace switcher') });
        layout.pack(label, 0, 1);

        entry = new St.Entry({ style_class: 'workspace-dialog-entry', can_focus: true });

        this._rowEntry = entry.clutter_text;
        layout.pack(entry, 1, 1);

        label = new St.Label({ style_class: 'workspace-dialog-label',
                                   text: _f('Dynamic workspaces') });
        layout.pack(label, 0, 2);

        this._dynamicWorkspaces = new DynamicWorkspacesSwitch();
        layout.pack(this._dynamicWorkspaces.actor, 1, 2);

        label = new St.Label({ style_class: 'workspace-dialog-label',
                                   text: _f('Panel visible in workspace') });
        layout.pack(label, 0, 3);
        layout.child_set(label, { column_span: 2 });

        let cblayout = new Clutter.TableLayout();
        let cbtable = new St.Widget({reactive: true,
                              layout_manager: cblayout,
                              styleClass: 'workspace-dialog-table'});

        let ncols = get_ncols();
        this.cb = [];
        for ( let r=0; r<nrows; ++r ) {
            for ( let c=0; c<ncols; ++c ) {
                let i = r*ncols + c;
                if ( i < global.screen.n_workspaces ) {
                    this.cb[i] = new CheckBox.CheckBox();
                    if ( i == 0 ) {
                        this.cb[i].actor.checked = true;
                        this.cb[i].actor.reactive = false;
                        this.cb[i].actor.can_focus = false;
                    }
                    else {
                        this.cb[i].actor.checked = show_panel[i];
                    }
                    cblayout.pack(this.cb[i].actor, c, r);
                    cblayout.child_set(this.cb[i].actor, { x_fill: false });
                }
            }
        }
        layout.pack(cbtable, 0, 4);
        layout.child_set(cbtable, { column_span: 2 });

        let buttons = [{ action: Lang.bind(this, this.close),
                         label:  _("Cancel"),
                         key:    Clutter.Escape},
                       { action: Lang.bind(this, function() {
                                        this._updateValues();
                                        this.close();}),
                         label:  _("OK"),
                         default: true }];

        this.setButtons(buttons);
    },

    open: function() {
        this._workspaceEntry.set_text(''+global.screen.n_workspaces);
        this._rowEntry.set_text(''+nrows);
        this._dynamicWorkspaces.updateState();

        this.parent();
    },

    _updateValues: function() {
        let changed = false;
        for ( let i=0; i<this.cb.length; ++i ) {
            if ( show_panel[i] != this.cb[i].actor.checked ) {
                show_panel[i] = this.cb[i].actor.checked;
                changed = true;
            }
        }

        if ( changed ) {
            let value = GLib.Variant.new('ab', show_panel);
            bottomPanel._settings.set_value(SETTINGS_SHOW_PANEL, value);
        }

        let num = parseInt(this._workspaceEntry.get_text());
        if ( !isNaN(num) && num >= 2 && num <= 32 ) {
            let old_num = global.screen.n_workspaces;
            if ( num > old_num ) {
                for ( let i=old_num; i<num; ++i ) {
                    global.screen.append_new_workspace(false,
                            global.get_current_time());
                }
            }
            else if ( num < old_num ) {
                for ( let i=old_num-1; i>=num; --i ) {
                    let ws = global.screen.get_workspace_by_index(i);
                    global.screen.remove_workspace(ws,
                            global.get_current_time());
                }
            }
        }

        let rows = parseInt(this._rowEntry.get_text());
        if ( !isNaN(rows) && rows > 0 && rows < 6 && rows != nrows ) {
            if ( rows != nrows ) {
                nrows = rows;
                bottomPanel._settings.set_int(SETTINGS_NUM_ROWS, nrows);
            }
        }
    }
});
Signals.addSignalMethods(WorkspaceDialog.prototype);

const WorkspaceButton = new Lang.Class({
    Name: 'WorkspaceButton',
    Extends: TooltipChild,

    _init: function(index) {
        this.parent();

        this.actor = new St.Button({ name: 'workspaceButton',
                                 style_class: 'workspace-button',
                                 reactive: true });
        this.actor.connect('clicked', Lang.bind(this, this._onClicked));
        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));

        this.label = new St.Label();
        this.actor.set_child(this.label);

        this.tooltip = new St.Label({ style_class: 'bottom-panel-tooltip'});
        this.tooltip.hide();
        Main.layoutManager.addChrome(this.tooltip);
        this.actor.label_actor = this.tooltip;

        this.setIndex(index);
    },

    _onClicked: function() {
        if ( this.index >= 0 && this.index < global.screen.n_workspaces ) {
            let metaWorkspace = global.screen.get_workspace_by_index(this.index);
            metaWorkspace.activate(global.get_current_time());
        }

        return true;
    },

    _onDestroy: function() {
        this.tooltip.destroy();
    },

    setIndex: function(index) {
        if ( index < 0 || index >= global.screen.n_workspaces ) {
            return;
        }

        this.index = index;

        let active = global.screen.get_active_workspace_index();

        if ( index == active ) {
            this.label.set_text('-' + (index+1).toString() + '-');
            this.actor.add_style_pseudo_class('outlined');
        }
        else if ( index < global.screen.n_workspaces ) {
            this.label.set_text((index+1).toString());
            this.actor.remove_style_pseudo_class('outlined');
        }
        else {
            this.label.set_text('');
            this.actor.remove_style_pseudo_class('outlined');
        }
        this.tooltip.set_text(Meta.prefs_get_workspace_name(index));
    }
});

const WorkspaceSwitcher = new Lang.Class({
    Name: 'WorkspaceSwitcher',
    Extends: TooltipContainer,

    _init: function() {
        this.parent();

        this.actor = new St.BoxLayout({ name: 'workspaceSwitcher',
                                        style_class: 'workspace-switcher',
                                        reactive: true });
        this.actor.connect('button-release-event', this._showDialog);
        this.actor.connect('scroll-event', this._onScroll);
        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
        this.actor._delegate = this;
        this.button = [];
        this._createButtons();

        this._onNWorkspacesId = global.screen.connect('notify::n-workspaces',
                                Lang.bind(this, this._createButtons));
        this._onSwitchWorkspaceId = global.window_manager.connect(
                                'switch-workspace',
                                Lang.bind(this, this._updateButtons));
    },

    _createButtons: function() {
        this.actor.destroy_all_children();
        this.button = [];

        this.row_indicator = null;
        if ( nrows > 1 ) {
            this.row_indicator = new St.DrawingArea({ reactive: true,
                                    style_class: 'workspace-row-indicator' });
            this.row_indicator.connect('repaint', Lang.bind(this, this._draw));
            this.row_indicator.connect('button-press-event', Lang.bind(this, this._rowButtonPress));
            this.row_indicator.connect('scroll-event', Lang.bind(this, this._rowScroll));
            this.actor.add(this.row_indicator);
        }

        let ncols = get_ncols();
        let active = global.screen.get_active_workspace_index();
        let row = Math.floor(active/ncols);

        let index = row*ncols;
        for ( let i=0; i<ncols; ++i ) {
            let btn = new WorkspaceButton(index++);
            this.actor.add(btn.actor);
            btn.actor.connect('notify::hover',
                       Lang.bind(this, function() {
                            this._onHover(btn);
                        }));
            this.button[i] = btn;
        }

        global.screen.override_workspace_layout(Meta.ScreenCorner.TOPLEFT,
                false, nrows, ncols);
    },

    _updateButtons: function() {
        let ncols = get_ncols();
        let active = global.screen.get_active_workspace_index();
        let row = Math.floor(active/ncols);

        let index = row*ncols;
        for ( let i=0; i<this.button.length; ++i ) {
            this.button[i].setIndex(index++);
        }

        if ( this.row_indicator ) {
            this.row_indicator.queue_repaint();
        }
    },

    _showDialog: function(actor, event) {
        if ( event.get_button() == 3 ) {
            let _workspaceDialog = new WorkspaceDialog();
            _workspaceDialog.open();
            return true;
        }
        return false;
    },

    _onScroll: function(actor, event) {
        let direction = event.get_scroll_direction();
        let ncols = get_ncols();
        let active = global.screen.get_active_workspace_index();
        let index = global.screen.n_workspaces;

        if ( direction == Clutter.ScrollDirection.UP ) {
            if ( active%ncols > 0 ) {
                index = active-1;
            }
        }
        if ( direction == Clutter.ScrollDirection.DOWN ) {
            if ( active < global.screen.n_workspaces-1 &&
                         active%ncols != ncols-1 ) {
                index = active+1;
            }
        }

        if ( index >= 0 && index < global.screen.n_workspaces ) {
            let metaWorkspace = global.screen.get_workspace_by_index(index);
            metaWorkspace.activate(global.get_current_time());
        }

        return true;
    },

    _rowButtonPress: function(actor, event) {
        if ( event.get_button() != 1 ) {
            return false;
        }

        let ncols = get_ncols();
        let active = global.screen.get_active_workspace_index();
        let row = Math.floor(active/ncols);

        let [x, y] = event.get_coords();
        let [wx, wy] = actor.get_transformed_position();
        let [w, h] = actor.get_size();
        y -= wy;

        let new_row = Math.floor(nrows*y/h);
        let index = global.screen.n_workspaces;
        if ( new_row != row ) {
            index = new_row*ncols + active%ncols;
        }

        if ( index >= 0 && index < global.screen.n_workspaces ) {
            let metaWorkspace = global.screen.get_workspace_by_index(index);
            metaWorkspace.activate(global.get_current_time());
        }

        return true;
    },

    _rowScroll: function(actor, event) {
        let direction = event.get_scroll_direction();
        let ncols = get_ncols();
        let active = global.screen.get_active_workspace_index();
        let row = Math.floor(active/ncols);

        let index = global.screen.n_workspaces;
        if ( direction == Clutter.ScrollDirection.DOWN ) {
            index = (row+1)*ncols + active%ncols;
        }
        if ( direction == Clutter.ScrollDirection.UP ) {
            index = (row-1)*ncols + active%ncols;
        }

        if ( index >= 0 && index < global.screen.n_workspaces ) {
            let metaWorkspace = global.screen.get_workspace_by_index(index);
            metaWorkspace.activate(global.get_current_time());
        }

        return true;
    },

    _draw: function(area) {
        let [width, height] = area.get_surface_size();
        let themeNode = this.row_indicator.get_theme_node();
        let cr = area.get_context();

        let active_color = themeNode.get_color('-active-color');
        let inactive_color = themeNode.get_color('-inactive-color');

        let ncols = get_ncols();
        let active = global.screen.get_active_workspace_index();
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
    },

    _onDestroy: function() {
        global.screen.disconnect(this._onNWorkspacesId);
        global.window_manager.disconnect(this._onSwitchWorkspaceId);
    }
});

const BottomPanel = new Lang.Class({
    Name: 'BottomPanel',

    _init : function() {
        this._settings = Convenience.getSettings();

        let rows = this._settings.get_int(SETTINGS_NUM_ROWS);
        if ( !isNaN(rows) && rows > 0 && rows < 6 ) {
            nrows = rows;
        }

        let b = this._settings.get_value(SETTINGS_SHOW_PANEL).deep_unpack();
        if ( b.length > 1 ) {
            show_panel[0] = true;
            for ( let i=1; i<b.length; ++i ) {
                show_panel[i] = b[i];
            }
        }

        this.actor = new St.BoxLayout({ style_class: 'bottom-panel',
                                        name: 'bottomPanel',
                                        reactive: true });
        this.actor._delegate = this;

        let windowList = new WindowList();
        this.actor.add(windowList.actor, { expand: true });

        this.workspaceSwitcher = new WorkspaceSwitcher();
        this.actor.add(this.workspaceSwitcher.actor);

        Main.layoutManager.addChrome(this.actor, { affectsStruts: true,
                                                   trackFullscreen: true });
        Main.uiGroup.set_child_above_sibling(this.actor,
                Main.layoutManager.panelBox);

        this.actor.connect('style-changed', Lang.bind(this, this.relayout));
        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
		this.actor.connect('allocation-changed', Lang.bind(this, this._updateSolidStyle));

        this._monitorsChangedId = global.screen.connect('monitors-changed',
                Lang.bind(this, this.relayout));
        this._sessionUpdatedId = Main.sessionMode.connect('updated',
                Lang.bind(this, this._sessionUpdated));
        this._onSwitchWorkspaceId = global.window_manager.connect(
                                'switch-workspace',
                                Lang.bind(this, this.relayout));
        this._numRowsChangedId = this._settings.connect(
                                   'changed::'+SETTINGS_NUM_ROWS,
                                   Lang.bind(this, this._numRowsChanged));
        this._showPanelChangedId = this._settings.connect(
                                   'changed::'+SETTINGS_SHOW_PANEL,
                                   Lang.bind(this, this._showPanelChanged));
        this._overviewHidingId = Main.overview.connect('hiding',
                Lang.bind(this, function () { this._updateSolidStyle(); }));
        this._overviewShowingId = Main.overview.connect('showing', 
                Lang.bind(this, function () { this._updateSolidStyle(); }));

        this._trackedWindows = new Map();
        global.get_window_actors().forEach(a => {
            this._onWindowActorAdded(a.get_parent(), a);
        });

        this._onWindowActorAddedID = global.window_group.connect(
            'actor-added', Lang.bind(this, this._onWindowActorAdded));
        this._onWindowActorRemovedID = global.window_group.connect(
            'actor-removed', Lang.bind(this, this._onWindowActorRemoved));
    },

    _onWindowActorAdded: function(container, metaWindowActor) {
        let signalIds = [];
        ['allocation-changed', 'notify::visible'].forEach(s => {
            signalIds.push(metaWindowActor.connect(s,
                Lang.bind(this, this._updateSolidStyle)));
        });
        this._trackedWindows.set(metaWindowActor, signalIds);
    },

    _onWindowActorRemoved: function(container, metaWindowActor) {
        this._trackedWindows.get(metaWindowActor).forEach(id => {
            metaWindowActor.disconnect(id);
        });
        this._trackedWindows.delete(metaWindowActor);
        this._updateSolidStyle();
    },

    relayout: function() {
        let bottom = Main.layoutManager.bottomMonitor;

        let h = this.actor.get_theme_node().get_height();
        let active = global.screen.get_active_workspace_index();
        if ( !show_panel[active] ) h = -h;
        this.actor.set_position(bottom.x, bottom.y+bottom.height-h);
        this.actor.set_size(bottom.width, -1);
        this._updateSolidStyle();
    },

    _sessionUpdated: function() {
        this.actor.visible = Main.sessionMode.hasWorkspaces;
    },

    _numRowsChanged: function() {
        let rows = this._settings.get_int(SETTINGS_NUM_ROWS);
        if ( !isNaN(rows) && rows > 0 && rows < 6 ) {
            nrows = rows;
            this.workspaceSwitcher._createButtons();
        }
    },

    _showPanelChanged: function() {
        let b = this._settings.get_value(SETTINGS_SHOW_PANEL).deep_unpack();
        if ( b.length > 1 ) {
            show_panel[0] = true;
            for ( let i=1; i<b.length; ++i ) {
                show_panel[i] = b[i];
            }
        }
        this.relayout();
    },

    _onDestroy: function() {
        global.screen.disconnect(this._monitorsChangedId);
        global.window_manager.disconnect(this._onSwitchWorkspaceId);
        Main.sessionMode.disconnect(this._sessionUpdatedId);

        if ( this._numRowsChangedId != 0 ) {
            this._settings.disconnect(this._numRowsChangedId);
            this._numRowsChangedId = 0;
        }

        if ( this._showPanelChangedId != 0 ) {
            this._settings.disconnect(this._showPanelChangedId);
            this._showPanelChangedId = 0;
        }

        if ( this._overviewHidingId != 0 ) {
            Main.overview.disconnect(this._overviewHidingId);
            this._overviewHidingId = 0;
        }

        if ( this._overviewShowingId != 0 ) {
            Main.overview.disconnect(this._overviewShowingId);
            this._overviewShowingId = 0;
        }

        if ( this._onWindowActorAddedID != 0 ) {
            global.window_group.disconnect(this._onWindowActorAddedID);
            this._onWindowActorAddedID = 0;
        }

        if ( this._onWindowActorRemovedID != 0 ) {
            global.window_group.disconnect(this._onWindowActorRemovedID);
            this._onWindowActorRemovedID = 0;
        }
    },

    _updateSolidStyle: function() {
        if (this.actor.has_style_pseudo_class('overview') || !Main.sessionMode.hasWindows) {
            this._removeStyleClassName('solid');
            return;
        }

        /* Get all the windows in the active workspace that are in the primary monitor and visible */
        let activeWorkspace = global.screen.get_active_workspace();
        let windows = activeWorkspace.list_windows().filter(function(metaWindow) {
            return metaWindow.is_on_primary_monitor() &&
                   metaWindow.showing_on_its_workspace() &&
                   metaWindow.get_window_type() != Meta.WindowType.DESKTOP;
        });

        /* Check if at least one window is near enough to the panel */
        let [, panelTop] = this.actor.get_transformed_position();
        let scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        let isNearEnough = windows.some(Lang.bind(this, function(metaWindow) {
            let rect = metaWindow.get_frame_rect();
            let verticalPosition = rect.y + rect.height;
            return verticalPosition > panelTop - 5 * scale;
        }));

        if (isNearEnough)
            this.actor.add_style_class_name('solid');
        else
            this.actor.remove_style_class_name('solid');
    }

});

const FRIPPERY_TIMEOUT = 400;

const FripperySwitcherPopup = new Lang.Class({
    Name: 'FripperySwitcherPopup',
    Extends:  WorkspaceSwitcherPopup.WorkspaceSwitcherPopup,

    _getPreferredHeight : function (actor, forWidth, alloc) {
        let children = this._list.get_children();
        let workArea = Main.layoutManager.getWorkAreaForMonitor(
                        Main.layoutManager.primaryIndex);

        let availHeight = workArea.height;
        availHeight -= this.actor.get_theme_node().get_vertical_padding();
        availHeight -= this._container.get_theme_node().get_vertical_padding();
        availHeight -= this._list.get_theme_node().get_vertical_padding();

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

        alloc.min_size = height;
        alloc.natural_size = height;
    },

    _getPreferredWidth : function (actor, forHeight, alloc) {
        let children = this._list.get_children();
        let workArea = Main.layoutManager.getWorkAreaForMonitor(
                        Main.layoutManager.primaryIndex);

        let availWidth = workArea.width;
        availWidth -= this.actor.get_theme_node().get_horizontal_padding();
        availWidth -= this._container.get_theme_node().get_horizontal_padding();
        availWidth -= this._list.get_theme_node().get_horizontal_padding();

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

        alloc.min_size = width;
        alloc.natural_size = width;
    },

    _allocate : function (actor, box, flags) {
        let children = this._list.get_children();
        let childBox = new Clutter.ActorBox();

        let ncols = get_ncols();

        for ( let ir=0; ir<nrows; ++ir ) {
            for ( let ic=0; ic<ncols; ++ic ) {
                let i = ncols*ir + ic;
                let x = box.x1 + ic * (this._childWidth + this._itemSpacing);
                childBox.x1 = x;
                childBox.x2 = x + this._childWidth;
                let y = box.y1 + ir * (this._childHeight + this._itemSpacing);
                childBox.y1 = y;
                childBox.y2 = y + this._childHeight;
                children[i].allocate(childBox, flags);
            }
        }
    },

    _redisplay : function() {
        this._list.destroy_all_children();

        for (let i = 0; i < global.screen.n_workspaces; i++) {
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
    },

    display : function(direction, activeWorkspaceIndex) {
        this._direction = direction;
        this._activeWorkspaceIndex = activeWorkspaceIndex;

        this._redisplay();
        if (this._timeoutId != 0)
            Mainloop.source_remove(this._timeoutId);
        this._timeoutId = Mainloop.timeout_add(FRIPPERY_TIMEOUT, Lang.bind(this, this._onTimeout));
        this._show();
    }
});

let myShowWorkspaceSwitcher, origShowWorkspaceSwitcher;

function init(extensionMeta) {
    Convenience.initTranslations();

    origShowWorkspaceSwitcher =
        WindowManager.WindowManager.prototype._showWorkspaceSwitcher;

    myShowWorkspaceSwitcher = function(display, screen, window, binding) {
        if (!Main.sessionMode.hasWorkspaces)
            return;

        if (screen.n_workspaces == 1)
            return;

        let [action,,,target] = binding.get_name().split('-');
        let newWs;
        let direction;

        if (isNaN(target)) {
            direction = Meta.MotionDirection[target.toUpperCase()];
            newWs = screen.get_active_workspace().get_neighbor(direction);
        } else if (target > 0) {
            target--;
            newWs = screen.get_workspace_by_index(target);

            // FIXME add proper support for switching to numbered workspace
            if (screen.get_active_workspace().index() > target)
                direction = Meta.MotionDirection.UP;
            else
                direction = Meta.MotionDirection.DOWN;
        }

        if (action == 'switch')
            this.actionMoveWorkspace(newWs);
        else
            this.actionMoveWindow(window, newWs);

        if (!Main.overview.visible) {
            if (this._workspaceSwitcherPopup == null) {
                this._workspaceSwitcherPopup = new FripperySwitcherPopup();
                this._workspaceSwitcherPopup.connect('destroy',
                    Lang.bind(this, function() {
                        this._workspaceSwitcherPopup = null;
                    }));
            }
            this._workspaceSwitcherPopup.display(direction, newWs.index());
        }
    };

    WindowManager.WindowManager.prototype._reset = function() {
        Meta.keybindings_set_custom_handler('switch-to-workspace-left',
                    Lang.bind(this, this._showWorkspaceSwitcher));
        Meta.keybindings_set_custom_handler('switch-to-workspace-right',
                    Lang.bind(this, this._showWorkspaceSwitcher));
        Meta.keybindings_set_custom_handler('switch-to-workspace-up',
                    Lang.bind(this, this._showWorkspaceSwitcher));
        Meta.keybindings_set_custom_handler('switch-to-workspace-down',
                    Lang.bind(this, this._showWorkspaceSwitcher));
        Meta.keybindings_set_custom_handler('move-to-workspace-left',
                    Lang.bind(this, this._showWorkspaceSwitcher));
        Meta.keybindings_set_custom_handler('move-to-workspace-right',
                    Lang.bind(this, this._showWorkspaceSwitcher));
        Meta.keybindings_set_custom_handler('move-to-workspace-up',
                    Lang.bind(this, this._showWorkspaceSwitcher));
        Meta.keybindings_set_custom_handler('move-to-workspace-down',
                    Lang.bind(this, this._showWorkspaceSwitcher));

        this._workspaceSwitcherPopup = null;
    };
}

let bottomPanel = null;

function enable() {
    if ( Main.sessionMode.currentMode == 'classic' ) {
        log('Frippery Bottom Panel does not work in Classic mode');
        return;
    }

    WindowManager.WindowManager.prototype._showWorkspaceSwitcher =
        myShowWorkspaceSwitcher;

    Main.wm._reset();

    bottomPanel = new BottomPanel();
    bottomPanel.relayout();
}

function disable() {
    if ( Main.sessionMode.currentMode == 'classic' ) {
        return;
    }

    global.screen.override_workspace_layout(Meta.ScreenCorner.TOPLEFT, false, -1, 1);

    WindowManager.WindowManager.prototype._showWorkspaceSwitcher =
        origShowWorkspaceSwitcher;

    Main.wm._reset();

    bottomPanel.actor.destroy();
    bottomPanel = null;
}
