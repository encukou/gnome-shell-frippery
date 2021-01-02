// Copyright (C) 2011-2020 R M Yorston
// Licence: GPLv2+

const { Clutter, Gio, GLib, GObject, Shell, St } = imports.gi;
const Signals = imports.signals;

const AppFavorites = imports.ui.appFavorites;
const Main = imports.ui.main;
const Panel = imports.ui.panel;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const ExtensionUtils = imports.misc.extensionUtils;

const _f = imports.gettext.domain('frippery-panel-favorites').gettext;

const PANEL_LAUNCHER_LABEL_SHOW_TIME = 0.15;
const PANEL_LAUNCHER_LABEL_HIDE_TIME = 0.1;
const PANEL_LAUNCHER_HOVER_TIMEOUT = 300;

const SETTINGS_FAVORITES_ENABLED = 'favorites-enabled';
const SETTINGS_FAVORITES_POSITION = 'favorites-position';
const SETTINGS_OTHER_APPS_ENABLED = 'other-apps-enabled';
const SETTINGS_OTHER_APPS_POSITION = 'other-apps-position';
const SETTINGS_OTHER_APPS = 'other-apps';

const PanelLauncher =
class PanelLauncher {
    constructor(app) {
        this.actor = new St.Button({ style_class: 'panel-button',
                                     reactive: true });
        let gicon = app.app_info.get_icon();
        let icon = new St.Icon({ gicon: gicon,
                                 style_class: 'panel-launcher-icon'});
        this.actor.set_child(icon);
        this.actor._delegate = this;
        let text = app.get_name();
        if ( app.get_description() ) {
            text += '\n' + app.get_description();
        }

        this.label = new St.Label({ style_class: 'panel-launcher-label'});
        this.label.set_text(text);
        Main.layoutManager.addChrome(this.label);
        this.label.hide();
        this.actor.label_actor = this.label;

        this._app = app;
        this._menu = null;
        this._menuManager = new PopupMenu.PopupMenuManager(this.actor);

        this.actor.connect('clicked', () => {
            this._app.open_new_window(-1);
            if ( Main.overview.visible ) {
                Main.overview.hide();
            }
        });
        this.actor.connect('notify::hover',
                this._onHoverChanged.bind(this));
        this.actor.connect('button-press-event',
                this._onButtonPress.bind(this));
        this.actor.opacity = 207;
    }

    _onHoverChanged(actor) {
        actor.opacity = actor.hover ? 255 : 207;
    }

    _onButtonPress(actor, event) {
        let button = event.get_button();
        if (button == 3) {
            this.popupMenu();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    // this code stolen from appDisplay.js
    popupMenu() {
        if (!this._menu) {
            this._menu = new AppIconMenu(this);
            this._menu.connect('activate-window', (menu, window) => {
                this.activateWindow(window);
            });
            this._menu.connect('open-state-changed', (menu, isPoppedUp) => {
                if (!isPoppedUp)
                    this.actor.sync_hover();
            });

            this._menuManager.addMenu(this._menu);
        }

        this.actor.set_hover(true);
        this._menu.popup();
        this._menuManager.ignoreRelease();

        return false;
    }

    activateWindow(metaWindow) {
        if (metaWindow) {
            Main.activateWindow(metaWindow);
        } else {
            Main.overview.hide();
        }
    }

    showLabel() {
        this.label.opacity = 0;
        this.label.show();

        let [stageX, stageY] = this.actor.get_transformed_position();

        let itemHeight = this.actor.allocation.y2 - this.actor.allocation.y1;
        let itemWidth = this.actor.allocation.x2 - this.actor.allocation.x1;
        let labelWidth = this.label.get_width();

        let node = this.label.get_theme_node();
        let yOffset = node.get_length('-y-offset');

        let y = stageY + itemHeight + yOffset;
        let x = Math.floor(stageX + itemWidth/2 - labelWidth/2);

        let parent = this.label.get_parent();
        let parentWidth = parent.allocation.x2 - parent.allocation.x1;

        if ( Clutter.get_default_text_direction() == Clutter.TextDirection.LTR ) {
            // stop long tooltips falling off the right of the screen
            x = Math.min(x, parentWidth-labelWidth-6);
            // but whatever happens don't let them fall of the left
            x = Math.max(x, 6);
        }
        else {
            x = Math.max(x, 6);
            x = Math.min(x, parentWidth-labelWidth-6);
        }

        this.label.set_position(x, y);
        this.label.remove_all_transitions();
        this.label.ease({
            opacity: 255,
            duration: PANEL_LAUNCHER_LABEL_SHOW_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD
       });
    }

    hideLabel() {
        this.label.opacity = 255;
        this.label.remove_all_transitions();
        this.label.ease({
            opacity: 0,
            duration: PANEL_LAUNCHER_LABEL_HIDE_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this.label.hide()
        });
    }

    destroy() {
        this.label.destroy();
        this.actor.destroy();
    }
};

const PF_ApplicationMenuItem = GObject.registerClass(
class PF_ApplicationMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(app, params) {
        super._init(params);

        let box = new St.BoxLayout({ name: 'applicationMenuBox',
                                     style_class: 'applications-menu-item-box'});
        this.actor.add_child(box);

        let icon = app.create_icon_texture(24);
        icon.x_align = Clutter.ActorAlign.CENTER;
        icon.y_align = Clutter.ActorAlign.CENTER;
        box.add(icon);

        let name = app.get_name();

        let matches = /^(OpenJDK Policy Tool) (.*)/.exec(name);
        if ( matches && matches.length == 3 ) {
            name = matches[1] + '\n' + matches[2];
        }

        matches = /^(OpenJDK 8 Policy Tool) (.*)/.exec(name);
        if ( matches && matches.length == 3 ) {
            name = matches[1] + '\n' + matches[2];
        }

        matches = /^(OpenJDK Monitoring & Management Console) (.*)/.exec(name);
        if ( matches && matches.length == 3 ) {
            name = 'OpenJDK Console\n' + matches[2];
        }

        matches = /^(OpenJDK 8 Monitoring & Management Console) (.*)/.exec(name);
        if ( matches && matches.length == 3 ) {
            name = 'OpenJDK 8 Console\n' + matches[2];
        }

        let label = new St.Label({ text: name });
        box.add(label);

        this.app = app;

        this.connect('activate', () => {
            let id = this.app.get_id();
            let app = Shell.AppSystem.get_default().lookup_app(id);
            app.open_new_window(-1);
        });
    }
});

const PanelAppsButton = GObject.registerClass(
class PanelAppsButton extends PanelMenu.Button {
    _init(details) {
        super._init(0.5, details.description, false);
        this._showLabelTimeoutId = 0;
        this._resetHoverTimeoutId = 0;
        this._labelShowing = false;

        this.name = details.name;
        this._details = details;

        this._box = new St.BoxLayout({ name: 'panelFavoritesBox',
                                        x_expand: true, y_expand: true,
                                        style_class: 'panel-favorites' });
        this.add_actor(this._box);

        this.connect('destroy', this._onDestroy.bind(this));
        this._installChangedId = Shell.AppSystem.get_default().connect('installed-changed', this._redisplay.bind(this));
        this._changedId = details.change_object.connect(details.change_event, this._redisplay.bind(this));

        this._display();
    }

    _redisplay() {
        for ( let i=0; i<this._buttons.length; ++i ) {
            this._buttons[i].destroy();
        }
        this.menu.removeAll();

        this._display();
    }

    _display() {
        let launchers = this._details.settings.get_strv(this._details.key);

        this._buttons = [];
        let j = 0;
        for ( let i=0; i<launchers.length; ++i ) {
            let app = Shell.AppSystem.get_default().lookup_app(launchers[i]);

            if ( app == null ) {
                continue;
            }

            let launcher = new PanelLauncher(app);
            this._box.add(launcher.actor);
            launcher.actor.connect('notify::hover',
                        () => this._onHover(launcher));
            this._buttons[j] = launcher;

            let menuItem = new PF_ApplicationMenuItem(app);
            this.menu.addMenuItem(menuItem, j);
            ++j;
        }
    }

    // this routine stolen from dash.js
    _onHover(launcher) {
        if ( launcher.actor.hover ) {
            if (this._showLabelTimeoutId == 0) {
                let timeout = this._labelShowing ?
                                0 : PANEL_LAUNCHER_HOVER_TIMEOUT;
                this._showLabelTimeoutId = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT, timeout,
                    () => {
                        this._labelShowing = true;
                        launcher.showLabel();
                        this._showLabelTimeoutId = 0;
                        return GLib.SOURCE_REMOVE;
                    });
                if (this._resetHoverTimeoutId > 0) {
                    GLib.source_remove(this._resetHoverTimeoutId);
                    this._resetHoverTimeoutId = 0;
                }
            }
        } else {
            if (this._showLabelTimeoutId > 0) {
                GLib.source_remove(this._showLabelTimeoutId);
                this._showLabelTimeoutId = 0;
            }
            launcher.hideLabel();
            if (this._labelShowing) {
                this._resetHoverTimeoutId = GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT, PANEL_LAUNCHER_HOVER_TIMEOUT,
                    () => {
                        this._labelShowing = false;
                        this._resetHoverTimeoutId = 0;
                        return GLib.SOURCE_REMOVE;
                    });
            }
        }
    }

    _onDestroy() {
        if ( this._installChangedId != 0 ) {
            Shell.AppSystem.get_default().disconnect(this._installChangedId);
            this._installChangedId = 0;
        }

        if ( this._changedId != 0 ) {
            this._details.change_object.disconnect(this._changedId);
            this._changedId = 0;
        }
    }
});

// this code stolen from appDisplay.js
const AppIconMenu =
class AppIconMenu extends PopupMenu.PopupMenu {
    constructor(source) {
        super(source.actor, 0.5, St.Side.TOP);

        // We want to keep the item hovered while the menu is up
        this.blockSourceEvents = true;

        this._source = source;

        this.actor.add_style_class_name('panel-menu');

        // Chain our visibility and lifecycle to that of the source
        this._sourceMappedId = source.actor.connect('notify::mapped', () => {
            if (!source.actor.mapped)
                this.close();
        });
        source.actor.connect('destroy', () => {
            source.actor.disconnect(this._sourceMappedId);
            this.destroy();
        });

        Main.uiGroup.add_actor(this.actor);
    }

    _redisplay() {
        this.removeAll();

        // find windows on current and other workspaces
        let activeWorkspace = global.workspace_manager.get_active_workspace();

        let w_here = this._source._app.get_windows().filter(function(w) {
            return !w.skip_taskbar && w.get_workspace() == activeWorkspace;
        });

        let w_there = this._source._app.get_windows().filter(function(w) {
            return !w.skip_taskbar && w.get_workspace() != activeWorkspace;
        });

        // if we have lots of windows use submenus in both cases to
        // avoid confusion
        let use_submenu = w_here.length + w_there.length > 10;

        this._appendWindows(use_submenu, _f('This Workspace'), w_here);

        if (w_here.length && !use_submenu) {
            this._appendSeparator();
        }

        this._appendWindows(use_submenu, _f('Other Workspaces'), w_there);

        if (!this._source._app.is_window_backed()) {
            if (w_there.length && !use_submenu) {
                this._appendSeparator();
            }

            let appInfo = this._source._app.get_app_info();
            let actions = appInfo.list_actions();
            if (this._source._app.can_open_new_window() &&
                actions.indexOf('new-window') == -1) {
                let item = this._appendMenuItem(_('New Window'));
                item.connect('activate', () => {
                    this._source._app.open_new_window(-1);
                    this.emit('activate-window', null);
                });
            }

            for (let i = 0; i < actions.length; i++) {
                let action = actions[i];
                let item = this._appendMenuItem(appInfo.get_action_name(action));
                item.connect('activate', (emitter, event) => {
                    this._source._app.launch_action(action, event.get_time(), -1);
                    this.emit('activate-window', null);
                });
            }

            let canFavorite = global.settings.is_writable('favorite-apps');

            if (canFavorite) {
                let isFavorite = AppFavorites.getAppFavorites().isFavorite(this._source._app.get_id());

                if (isFavorite) {
                    let item = this._appendMenuItem(_('Remove from Favorites'));
                    item.connect('activate', () => {
                        let favs = AppFavorites.getAppFavorites();
                        favs.removeFavorite(this._source._app.get_id());
                    });
                } else {
                    let item = this._appendMenuItem(_('Add to Favorites'));
                    item.connect('activate', () => {
                        let favs = AppFavorites.getAppFavorites();
                        favs.addFavorite(this._source.app.get_id());
                    });
                }
            }

            if (Shell.AppSystem.get_default().lookup_app('org.gnome.Software.desktop')) {
                let item = this._appendMenuItem(_('Show Details'));
                item.connect('activate', () => {
                    let id = this._source._app.get_id();
                    let args = GLib.Variant.new('(ss)', [id, '']);
                    Gio.DBus.get(Gio.BusType.SESSION, null, (o, res) => {
                        let bus = Gio.DBus.get_finish(res);
                        bus.call('org.gnome.Software',
                                 '/org/gnome/Software',
                                 'org.gtk.Actions', 'Activate',
                                 GLib.Variant.new('(sava{sv})',
                                                  ['details', [args], null]),
                                 null, 0, -1, null, null);
                        Main.overview.hide();
                    });
                });
            }
        }
    }

    _appendWindows(use_submenu, text, windows) {
        let parent = this;
        if (windows.length && use_submenu) {
            // if we have lots of activatable windows create a submenu
            let item = new PopupMenu.PopupSubMenuMenuItem(text);
            this.addMenuItem(item);
            parent = item.menu;
        }
        for (let i = 0; i < windows.length; i++) {
            let window = windows[i];
            let item = new PopupMenu.PopupMenuItem(window.title);
            parent.addMenuItem(item);
            item.connect('activate', () =>
                    this.emit('activate-window', window));
        }
    }

    _appendSeparator() {
        let separator = new PopupMenu.PopupSeparatorMenuItem();
        this.addMenuItem(separator);
    }

    _appendMenuItem(labelText) {
        let item = new PopupMenu.PopupMenuItem(labelText);
        this.addMenuItem(item);
        return item;
    }

    popup(activatingButton) {
        // this code stolen from PanelMenuButton
        // limit height of menu:  the menu should have scrollable submenus
        // for this to make sense
        let workArea = Main.layoutManager.getWorkAreaForMonitor(
                            Main.layoutManager.primaryIndex);
        let verticalMargins = this.actor.margin_top + this.actor.margin_bottom;
        this.actor.style = ('max-height: ' + Math.round(workArea.height -
                            verticalMargins) + 'px;');

        this._source.label.hide();
        this._redisplay();
        this.open();
    }
};
Signals.addSignalMethods(AppIconMenu.prototype);

const FAVORITES = 0;
const OTHER_APPS = 1;

const PanelFavoritesExtension =
class PanelFavoritesExtension {
    constructor() {
        ExtensionUtils.initTranslations();
        this._panelAppsButton = [ null, null ];
        this._settings = ExtensionUtils.getSettings();
    }

    _getPosition(key) {
        let position, box;
        // if key is false use left box, if true use right
        if (!this._settings.get_boolean(key)) {
            // place panel to left of app menu
            let siblings = Main.panel._leftBox.get_children();
            let appMenu = Main.panel.statusArea['appMenu'];
            position = appMenu ?
                    siblings.indexOf(appMenu.container) : siblings.length;
            box = 'left';
        }
        else {
            // place panel to left of aggregate menu
            let siblings = Main.panel._rightBox.get_children();
            let aggMenu = Main.panel.statusArea['aggregateMenu'];
            position = aggMenu ?
                    siblings.indexOf(aggMenu.container) : siblings.length-1;
            box = 'right';
        }
        return [position, box];
    }

    _configureButtons() {
        let details = [
            {
                description: _f('Favorites'),
                name: 'panelFavorites',
                settings: global.settings,
                key: AppFavorites.getAppFavorites().FAVORITE_APPS_KEY,
                change_object: AppFavorites.getAppFavorites(),
                change_event: 'changed'
            },
            {
                description: _f('Other Applications'),
                name: 'panelOtherApps',
                settings: ExtensionUtils.getSettings(),
                key: SETTINGS_OTHER_APPS,
                change_object: ExtensionUtils.getSettings(),
                change_event: 'changed::' + SETTINGS_OTHER_APPS
            }
        ];
        let role = [ 'panel-favorites', 'panel-other-apps' ];
        let prefix = [ 'favorites-', 'other-apps-' ];

        for ( let i=0; i<this._panelAppsButton.length; ++i ) {
            if (this._settings.get_boolean(prefix[i]+'enabled')) {
                if (!this._panelAppsButton[i]) {
                    // button is enabled but doesn't exist, create it
                    this._panelAppsButton[i] = new PanelAppsButton(details[i]);
                }
            }
            else {
                if (this._panelAppsButton[i]) {
                    // button is disabled but does exist, destroy it
                    this._panelAppsButton[i].emit('destroy');
                    this._panelAppsButton[i].destroy();
                    this._panelAppsButton[i] = null;
	            }
            }

            if (this._panelAppsButton[i]) {
                let indicator = Main.panel.statusArea[role[i]];
                let key = prefix[i]+'position';
                let [position, box] = this._getPosition(key);

                if (!indicator) {
                    // indicator with required role doesn't exist, create it
                    Main.panel.addToStatusArea(role[i],
                            this._panelAppsButton[i], position, box);
                }
                else {
                    let right_box, wrong_box;
                    if (this._settings.get_boolean(key)) {
                        right_box = Main.panel._rightBox;
                        wrong_box = Main.panel._leftBox;
                    }
                    else {
                        right_box = Main.panel._leftBox;
                        wrong_box = Main.panel._rightBox;
                    }

                    let children = wrong_box.get_children();
                    if (children.indexOf(indicator.container) != -1) {
                        // indicator exists but is in wrong box, move it
                        wrong_box.remove_actor(indicator.container);
                        right_box.insert_child_at_index(indicator.container,
                                    position);
                    }
                }
            }
        }
    }

    enable() {
        this._configureButtons();
        this._changedId = this._settings.connect('changed',
                this._configureButtons.bind(this));
    }

    disable() {
        let role = [ 'panel-favorites', 'panel-other-apps' ];

        if (this._changedId) {
            this._settings.disconnect(this._changedId);
        }

        for ( let i=0; i<this._panelAppsButton.length; ++i ) {
            if (this._panelAppsButton[i]) {
                let indicator = Main.panel.statusArea[role[i]];
                if (indicator) {
                    let parent = indicator.container.get_parent();
                    parent.remove_actor(indicator.container);
                }
                this._panelAppsButton[i].emit('destroy');
                this._panelAppsButton[i].destroy();
                this._panelAppsButton[i] = null;
            }
        }
    }
};

function init() {
    return new PanelFavoritesExtension();
}
