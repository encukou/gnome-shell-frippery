// Copyright (C) 2011-2017 R M Yorston
// Licence: GPLv2+

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GMenu = imports.gi.GMenu;
const Lang = imports.lang;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

const Layout = imports.ui.layout;
const Main = imports.ui.main;
const ModalDialog = imports.ui.modalDialog;
const Panel = imports.ui.panel;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

const _ = imports.gettext.domain('gnome-shell').gettext;
const _f = imports.gettext.domain('frippery-applications-menu').gettext;

const SETTINGS_SHOW_ICON = "show-icon";
const SETTINGS_SHOW_TEXT = "show-text";
const SETTINGS_ENABLE_HOT_CORNER = "enable-hot-corner";

const ApplicationMenuItem = new Lang.Class({
    Name: 'ApplicationMenuItem',
    Extends: PopupMenu.PopupBaseMenuItem,

    _init: function(app, params) {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this, params);

        let box = new St.BoxLayout({ name: 'applicationMenuBox',
                                     style_class: 'applications-menu-item-box'});
        this.actor.add_child(box);

        let icon = app.create_icon_texture(24);
        box.add(icon, { x_fill: false, y_fill: false });

        let name = app.get_name();

        let matches = /^(OpenJDK Policy Tool) (.*)/.exec(name);
        if ( matches && matches.length == 3 ) {
            name = matches[1] + "\n" + matches[2];
        }

        matches = /^(OpenJDK 8 Policy Tool) (.*)/.exec(name);
        if ( matches && matches.length == 3 ) {
            name = matches[1] + "\n" + matches[2];
        }

        matches = /^(OpenJDK Monitoring & Management Console) (.*)/.exec(name);
        if ( matches && matches.length == 3 ) {
            name = "OpenJDK Console\n" + matches[2];
        }

        matches = /^(OpenJDK 8 Monitoring & Management Console) (.*)/.exec(name);
        if ( matches && matches.length == 3 ) {
            name = "OpenJDK 8 Console\n" + matches[2];
        }

        let label = new St.Label({ text: name });
        box.add(label);

        this.app = app;

        this.connect('activate', Lang.bind(this, function() {
            let id = this.app.get_id();
            let app = Shell.AppSystem.get_default().lookup_app(id);
            app.open_new_window(-1);
        }));
    }
});

const ToggleSwitch = new Lang.Class({
    Name: 'ToggleSwitch',
    Extends: PopupMenu.Switch,

    _init: function(state) {
        PopupMenu.Switch.prototype._init.call(this, state);

        this.actor.can_focus = true;
        this.actor.reactive = true;
        this.actor.add_style_class_name("applications-menu-toggle-switch");

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
    },

    getState: function() {
        return this.state;
    }
});

const ShowHideSwitch = new Lang.Class({
    Name: 'ShowHideSwitch',
    Extends: ToggleSwitch,

    _init: function(item, state) {
        ToggleSwitch.prototype._init.call(this, state);

        this.item = item;
    },

    toggle: function() {
        ToggleSwitch.prototype.toggle.call(this);

        if ( this.state ) {
            this.item.show();
        }
        else {
            this.item.hide();
        }
    }
});

const ApplicationsMenuDialog = new Lang.Class({
    Name: 'ApplicationsMenuDialog',
    Extends: ModalDialog.ModalDialog,

    _init: function(button) {
        ModalDialog.ModalDialog.prototype._init.call(this,
                    { styleClass: 'applications-menu-dialog' });

        this.button = button;

        let layout= new Clutter.TableLayout();
        let table = new St.Widget({reactive: true,
                              layout_manager: layout,
                              styleClass: 'applications-menu-dialog-table'});
        layout.hookup_style(table);
        this.contentLayout.add(table, { y_align: St.Align.START });

        let label = new St.Label(
                        { style_class: 'applications-menu-dialog-label',
                          text: _f('Icon') });
        layout.pack(label, 0, 0);

        this.iconSwitch = new ShowHideSwitch(button._iconBox, true);
        this.iconSwitch.actor.set_accessible_name(_f('Icon'));
        layout.pack(this.iconSwitch.actor, 1, 0);

        label = new St.Label(
                        { style_class: 'applications-menu-dialog-label',
                          text: _f('Text') });
        layout.pack(label, 0, 1);

        this.labelSwitch = new ShowHideSwitch(button._label, true);
        this.labelSwitch.actor.set_accessible_name(_f('Text'));
        layout.pack(this.labelSwitch.actor, 1, 1);

        label = new St.Label({ style_class: 'applications-menu-dialog-label',
                        text: _f('Hot corner') });
        layout.pack(label, 0, 2);

        this.tlcSwitch = new ToggleSwitch(true);
        this.tlcSwitch.actor.set_accessible_name(_f('Hot corner'));
        this.tlcSwitch.toggle = Lang.bind(this.tlcSwitch, function() {
                PopupMenu.Switch.prototype.toggle.call(this);
                Main.layoutManager._setHotCornerState(this.getState());
            });
        layout.pack(this.tlcSwitch.actor, 1, 2);

        let buttons = [{ action: Lang.bind(this, this.close),
                         label:  _("Close"),
                         default: true }];

        this.setButtons(buttons);

        this._buttonKeys[Clutter.Escape] = this._buttonKeys[Clutter.Return];
    },

    open: function() {
        let state = this.button._settings.get_boolean(SETTINGS_SHOW_ICON);
        this.iconSwitch.setToggleState(state);

        state = this.button._settings.get_boolean(SETTINGS_SHOW_TEXT);
        this.labelSwitch.setToggleState(state);

        state = this.button._settings.get_boolean(SETTINGS_ENABLE_HOT_CORNER);
        this.tlcSwitch.setToggleState(state);

        ModalDialog.ModalDialog.prototype.open.call(this,
                global.get_current_time());
    },

    close: function() {
        let state = this.iconSwitch.getState();
        this.button._settings.set_boolean(SETTINGS_SHOW_ICON, state);

        state = this.labelSwitch.getState();
        this.button._settings.set_boolean(SETTINGS_SHOW_TEXT, state);

        state = this.tlcSwitch.getState();
        this.button._settings.set_boolean(SETTINGS_ENABLE_HOT_CORNER, state);

        ModalDialog.ModalDialog.prototype.close.call(this,
                global.get_current_time());
    }
});

const ApplicationsMenuButton = new Lang.Class({
    Name: 'ApplicationsMenuButton',
    Extends: PanelMenu.Button,

    _init: function() {
        this.parent(1.0, _("Applications"), false);

        this._box = new St.BoxLayout();

        this._iconBox = new St.Bin();
        this._box.add(this._iconBox, { y_align: St.Align.MIDDLE, y_fill: false });

        let logo = new St.Icon({ icon_name: 'start-here',
                                 style_class: 'applications-menu-button-icon'});
        this._iconBox.child = logo;

        let label = new St.Label({ text: " " });
        this._box.add(label, { y_align: St.Align.MIDDLE, y_fill: false });

        this._label = new St.Label({ text: _("Applications") });
        this._box.add(this._label, { y_align: St.Align.MIDDLE, y_fill: false });
        this.actor.add_actor(this._box);

        this._settings = Convenience.getSettings();
        this._settingsChangedId = this._settings.connect('changed',
                                   Lang.bind(this, this._settingsChanged));
        this._settingsChanged();

        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));

        this._appSystem = Shell.AppSystem.get_default();
        this._installChangedId = this._appSystem.connect('installed-changed',
                Lang.bind(this, this._rebuildMenu));

        // Since the hot corner uses stage coordinates, Clutter won't
        // queue relayouts for us when the panel moves. Queue a relayout
        // when that happens.  Stolen from apps-menu extension.
        this._panelBoxChangedId = Main.layoutManager.connect(
                'panel-box-changed', Lang.bind(this, function() {
                                        container.queue_relayout();
                                    }));

        this._buildMenu();

        this.actor.connect('button-release-event',
                    Lang.bind(this, this._showDialog));

        Main.layoutManager.connect('startup-complete',
                                   Lang.bind(this, this._setKeybinding));
        this._setKeybinding();
    },

    _setKeybinding: function() {
        Main.wm.setCustomKeybindingHandler('panel-main-menu',
                                   Shell.ActionMode.NORMAL |
                                   Shell.ActionMode.OVERVIEW,
                                   Lang.bind(this, function() {
                                       this.menu.toggle();
                                   }));
    },

    _onEvent: function(actor, event) {
        if ( event.type() == Clutter.EventType.BUTTON_RELEASE &&
                event.get_button() == 3 ) {
            return Clutter.EVENT_PROPAGATE;
        }

        if ( event.type() == Clutter.EventType.BUTTON_PRESS &&
                event.get_button() == 3 ) {
            return Clutter.EVENT_STOP;
        }

        if ( !this._settings.get_boolean(SETTINGS_SHOW_ICON) &&
                !this._settings.get_boolean(SETTINGS_SHOW_TEXT) ) {
            return Clutter.EVENT_STOP;
        }

        return PanelMenu.Button.prototype._onEvent.call(this, actor, event);
    },

    _onDestroy: function() {
        if ( this._installChangedId != 0 ) {
            this._appSystem.disconnect(this._installChangedId);
            this._installChangedId = 0;
        }

        if ( this._panelBoxChangedId != 0 ) {
            Main.layoutManager.disconnect(this._panelBoxChangedId);
            this._panelBoxChangedId = 0;
        }

        if ( this._settingsChangedId != 0 ) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }

        Main.wm.setCustomKeybindingHandler('panel-main-menu',
                           Shell.ActionMode.NORMAL |
                           Shell.ActionMode.OVERVIEW,
                           Main.sessionMode.hasOverview ?
                           Lang.bind(Main.overview, Main.overview.toggle) :
                           null);
    },

    // Stolen from appDisplay.js and apps-menu extension
    _loadCategory: function(dir, appList) {
        let iter = dir.iter();
        let nextType;
        while ((nextType = iter.next()) != GMenu.TreeItemType.INVALID) {
            if (nextType == GMenu.TreeItemType.ENTRY) {
                let entry = iter.get_entry();
                let id;
                try {
                    id = entry.get_desktop_file_id();
                }
                catch (e) {
                    continue;
                }
                let app = this._appSystem.lookup_app(id);
                if (app && app.get_app_info().should_show())
                    appList.push(app);
            } else if (nextType == GMenu.TreeItemType.DIRECTORY) {
                var itemDir = iter.get_directory();
                if (!itemDir.get_is_nodisplay())
                    this._loadCategory(itemDir, appList);
            }
        }
    },

    _buildSections: function() {
        // Stolen from appDisplay.js and apps-menu extension
        var tree = new GMenu.Tree({menu_basename: 'applications.menu'});
        tree.load_sync();
        var root = tree.get_root_directory();

        var iter = root.iter();
        var nextType;

        var sections = [];
        while ((nextType = iter.next()) != GMenu.TreeItemType.INVALID) {
            if (nextType == GMenu.TreeItemType.DIRECTORY) {
                var dir = iter.get_directory();
                if (dir.get_is_nodisplay())
                    continue;
                var appList = [];
                this._loadCategory(dir, appList);
                if ( appList.length != 0 ) {
                    sections.push({ name: dir.get_name(),
                                    apps: appList });
                }
            }
        }

        return sections;
    },

    _buildMenu: function() {
        let sections = this._buildSections();
        for ( let i=0; i<sections.length; ++i ) {
            let section = sections[i];
            let submenu = new PopupMenu.PopupSubMenuMenuItem(section.name);
            this.menu.addMenuItem(submenu);

            for ( let j=0; j<section.apps.length; ++j ) {
                let app = section.apps[j];
                let menuItem = new ApplicationMenuItem(app);

                submenu.menu.addMenuItem(menuItem, j);
            }
    }
    },

    _rebuildMenu: function() {
        this.menu.removeAll();
        this._buildMenu();
    },

    _showDialog: function(actor, event) {
        if ( event.get_button() == 3 ) {
            let applicationsMenuDialog = new ApplicationsMenuDialog(this);
            applicationsMenuDialog.open();
            return true;
        }
        return false;
    },

    _settingsChanged: function() {
        if ( this._settings.get_boolean(SETTINGS_SHOW_ICON) ) {
            this._iconBox.show();
        }
        else {
            this._iconBox.hide();
        }

        if ( this._settings.get_boolean(SETTINGS_SHOW_TEXT) ) {
            this._label.show();
        }
        else {
            this._label.hide();
        }

        let state = this._settings.get_boolean(SETTINGS_ENABLE_HOT_CORNER);
        Main.layoutManager._setHotCornerState(state);
    }
});

const ApplicationsMenuExtension = new Lang.Class({
    Name: 'ApplicationsMenuExtension',

    _init: function(extensionMeta) {
        Convenience.initTranslations();
    },

    enable: function() {
        let mode = Main.sessionMode.currentMode;
        if ( mode == 'classic' ) {
            log('Frippery Applications Menu does not work in Classic mode');
            return;
        }

        // inject a flag into the hot corner update function so we can
        // prevent updates when we've disabled the hot corner
        Layout.LayoutManager.prototype._origUpdateHotCorners =
                Layout.LayoutManager.prototype._updateHotCorners;
        Layout.LayoutManager.prototype._updateHotCorners = function() {
           if ( this._hotCornersEnabled ) {
               this._origUpdateHotCorners();
           }
        };

        Layout.LayoutManager.prototype._setHotCornerState = function(state) {
            // only do work if state is changing
            if ( state && !this._hotCornersEnabled ) {
                this._origUpdateHotCorners();
            }
            else if ( !state && this._hotCornersEnabled ) {
                this.hotCorners.forEach(function(corner) {
                    if (corner)
                        corner.destroy();
                });
                this.hotCorners = [];
            }
            this._hotCornersEnabled = state;
        };
        Main.layoutManager._hotCornersEnabled = true;

        this.activitiesButton = Main.panel.statusArea['activities'];
        if ( this.activitiesButton ) {
            this.activitiesButton.container.hide();
        }

        this.applicationsButton = new ApplicationsMenuButton();
        Main.panel.addToStatusArea('frippery-apps', this.applicationsButton,
                0, 'left');
    },

    disable: function() {
        let mode = Main.sessionMode.currentMode;
        if ( mode == 'classic' ) {
            return;
        }

        Layout.LayoutManager.prototype._updateHotCorners =
                Layout.LayoutManager.prototype._origUpdateHotCorners;
        delete Layout.LayoutManager.prototype._origUpdateHotCorners;
        delete Layout.LayoutManager.prototype._disableHotCorners;
        delete Main.layoutManager._hotCornersEnabled;
        Main.layoutManager._updateHotCorners();

        Main.panel.menuManager.removeMenu(this.applicationsButton.menu);
        this.applicationsButton.destroy();

        if ( this.activitiesButton ) {
            this.activitiesButton.container.show();
        }
    }
});

function init(extensionMeta) {
    return new ApplicationsMenuExtension(extensionMeta);
}
