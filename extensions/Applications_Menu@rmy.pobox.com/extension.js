// Copyright (C) 2011-2021 R M Yorston
// Licence: GPLv2+

const { Atk, Clutter, Gio, GLib, GMenu, GObject, Shell, St } = imports.gi;

const Main = imports.ui.main;
const ModalDialog = imports.ui.modalDialog;
const Panel = imports.ui.panel;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const ExtensionUtils = imports.misc.extensionUtils;

const appSys = Shell.AppSystem.get_default();

const _ = imports.gettext.domain('gnome-shell').gettext;
const _f = imports.gettext.domain('frippery-applications-menu').gettext;

const SETTINGS_SHOW_ICON = "show-icon";
const SETTINGS_SHOW_TEXT = "show-text";

var AM_ApplicationMenuItem = GObject.registerClass(
class AM_ApplicationMenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(app, params) {
        super._init(params);

        let box = new St.BoxLayout({ name: 'applicationMenuBox',
                                     style_class: 'applications-menu-item-box'});
        this.add_child(box);

        let icon = app.create_icon_texture(24);
        icon.x_align = Clutter.ActorAlign.CENTER;
        icon.y_align = Clutter.ActorAlign.CENTER;
        box.add(icon);

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

        let label = new St.Label({
                            text: name,
                            y_align: Clutter.ActorAlign.CENTER});
        box.add(label);

        this.app = app;
    }

    activate(event) {
        let id = this.app.get_id();
        let app = Shell.AppSystem.get_default().lookup_app(id);
        app.open_new_window(-1);
        super.activate(event);
    }
});

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
        this.actor.add_style_class_name("applications-menu-toggle-switch");

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

    getState() {
        return this.state;
    }
};

const ShowHideSwitch =
class ShowHideSwitch extends ToggleSwitch {
    constructor(item, state) {
        super(state);

        this.item = item;
    }

    toggle() {
        super.toggle();

        if ( this.state ) {
            this.item.show();
        }
        else {
            this.item.hide();
        }
    }
};

var ApplicationsMenuDialog = GObject.registerClass(
class ApplicationsMenuDialog extends ModalDialog.ModalDialog {
    _init(button) {
        super._init({ styleClass: 'applications-menu-dialog' });

        this.button = button;

        let layout= new Clutter.GridLayout();
        let table = new St.Widget({reactive: true,
                              layout_manager: layout,
                              y_align: Clutter.ActorAlign.START,
                              styleClass: 'applications-menu-dialog-box'});
        layout.hookup_style(table);
        this.contentLayout.add(table);

        let label = new St.Label({
                            style_class: 'applications-menu-dialog-label',
                            y_align: Clutter.ActorAlign.CENTER,
                            text: _f('Icon')});
        layout.attach(label, 0, 0, 1, 1);

        this.iconSwitch = new ShowHideSwitch(button._iconBox, true);
        this.iconSwitch.actor.set_accessible_name(_f('Icon'));
        layout.attach(this.iconSwitch.actor, 1, 0, 1, 1);

        label = new St.Label({
                        style_class: 'applications-menu-dialog-label',
                        y_align: Clutter.ActorAlign.CENTER,
                        text: _f('Text')});
        layout.attach(label, 0, 1, 1, 1);

        this.labelSwitch = new ShowHideSwitch(button._label, true);
        this.labelSwitch.actor.set_accessible_name(_f('Text'));
        layout.attach(this.labelSwitch.actor, 1, 1, 1, 1);

        let buttons = [{ action: this.close.bind(this),
                         label:  _('Close'),
                         default: true }];

        this.setButtons(buttons);

        this.dialogLayout._buttonKeys[Clutter.KEY_Escape] =
            this.dialogLayout._buttonKeys[Clutter.KEY_Return];
    }

    open() {
        let state = this.button._settings.get_boolean(SETTINGS_SHOW_ICON);
        this.iconSwitch.setToggleState(state);

        state = this.button._settings.get_boolean(SETTINGS_SHOW_TEXT);
        this.labelSwitch.setToggleState(state);

        super.open(global.get_current_time());
    }

    close() {
        let state = this.iconSwitch.getState();
        this.button._settings.set_boolean(SETTINGS_SHOW_ICON, state);

        state = this.labelSwitch.getState();
        this.button._settings.set_boolean(SETTINGS_SHOW_TEXT, state);

        super.close(global.get_current_time());
    }
});

const ApplicationsMenuButton = GObject.registerClass(
class ApplicationsMenuButton extends PanelMenu.Button {
    _init() {
        super._init(1.0, _('Applications'), false);

        this._box = new St.BoxLayout();

        this._iconBox = new St.Bin({
                                y_align: Clutter.ActorAlign.CENTER});
        this._box.add(this._iconBox);

        let logo = new St.Icon({ icon_name: 'start-here',
                                 style_class: 'applications-menu-button-icon'});
        this._iconBox.child = logo;
        this._iconBox.opacity = 207;
        this.connect('notify::hover', this._onHoverChanged.bind(this));

        let label = new St.Label({
                            text: " ",
                            y_align: Clutter.ActorAlign.CENTER});
        this._box.add(label);

        this._label = new St.Label({
                              text: _('Applications'),
                              y_align: Clutter.ActorAlign.CENTER});
        this._box.add(this._label);
        this.add_actor(this._box);

        this._settings = ExtensionUtils.getSettings();
        this._settingsChangedId = this._settings.connect('changed',
                                    this._settingsChanged.bind(this));
        this._settingsChanged();

        this.connect('destroy', this._onDestroy.bind(this));

        this._installChangedId = appSys.connect('installed-changed',
                                    this._rebuildMenu.bind(this));

        this._tree = new GMenu.Tree({ menu_basename: 'applications.menu' });
        this._treeChangedId = this._tree.connect('changed',
                                    this._rebuildMenu.bind(this));

        this._buildMenu();

        this.connect('button-release-event', this._showDialog.bind(this));

        Main.layoutManager.connect('startup-complete',
                                     this._setKeybinding.bind(this));
        this._setKeybinding();
    }

    _onHoverChanged(actor) {
        this._iconBox.opacity = actor.hover ? 255 : 207;
    }

    _setKeybinding() {
        Main.wm.setCustomKeybindingHandler('panel-main-menu',
                                   Shell.ActionMode.NORMAL |
                                   Shell.ActionMode.OVERVIEW,
                                   () => this.menu.toggle());
    }

	vfunc_event(event) {
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

        return PanelMenu.Button.prototype.vfunc_event.call(this, event);
    }

    _onDestroy() {
        if ( this._installChangedId != 0 ) {
            appSys.disconnect(this._installChangedId);
            this._installChangedId = 0;
        }

        if ( this._treeChangedId != 0 ) {
            this._tree.disconnect(this._treeChangedId);
            this._treeChangedId = 0;
        }
        this._tree = null;

        if ( this._settingsChangedId != 0 ) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }

        let handler = Main.sessionMode.hasOverview ?
            Main.overview.toggle.bind(Main.overview) : null;
        Main.wm.setCustomKeybindingHandler('panel-main-menu',
                           Shell.ActionMode.NORMAL |
                           Shell.ActionMode.OVERVIEW,
                           handler);
    }

    // Stolen from apps-menu extension
    _loadCategory(dir, appList) {
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
                let app = appSys.lookup_app(id);
                if (!app)
                    app = new Shell.App({ app_info: entry.get_app_info() });
                if (app && app.get_app_info().should_show())
                    appList.push(app);
            } else if (nextType == GMenu.TreeItemType.DIRECTORY) {
                var itemDir = iter.get_directory();
                if (!itemDir.get_is_nodisplay())
                    this._loadCategory(itemDir, appList);
            }
        }
    }

    _buildSections() {
        // Stolen from apps-menu extension
        this._tree.load_sync();
        var root = this._tree.get_root_directory();

        var iter = root.iter();
        var nextType;

        var sections = [];
        while ((nextType = iter.next()) != GMenu.TreeItemType.INVALID) {
            if (nextType != GMenu.TreeItemType.DIRECTORY)
                continue;

            var dir = iter.get_directory();
            if (dir.get_is_nodisplay())
                continue;
            var appList = [];
            this._loadCategory(dir, appList);
            if ( appList.length != 0 ) {
                sections.push({ name: dir.get_name(), apps: appList });
            }
        }

        return sections;
    }

    _buildMenu() {
        let sections = this._buildSections();
        for ( let i=0; i<sections.length; ++i ) {
            let section = sections[i];
            let submenu = new PopupMenu.PopupSubMenuMenuItem(section.name);
            this.menu.addMenuItem(submenu);

            for ( let j=0; j<section.apps.length; ++j ) {
                let app = section.apps[j];
                let menuItem = new AM_ApplicationMenuItem(app);

                submenu.menu.addMenuItem(menuItem, j);
            }
        }
    }

    _rebuildMenu() {
        this.menu.removeAll();
        this._buildMenu();
    }

    _showDialog(actor, event) {
        if ( event.get_button() == 3 ) {
            let applicationsMenuDialog = new ApplicationsMenuDialog(this);
            applicationsMenuDialog.open();
            return true;
        }
        return false;
    }

    _settingsChanged() {
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
    }
});

const ApplicationsMenuExtension =
class ApplicationsMenuExtension {
    constructor() {
        ExtensionUtils.initTranslations();
    }

    enable() {
        let mode = Main.sessionMode.currentMode;
        if ( mode == 'classic' ) {
            log('Frippery Applications Menu does not work in Classic mode');
            return;
        }

        this.activitiesButton = Main.panel.statusArea['activities'];
        if ( this.activitiesButton ) {
            this.activitiesButton.container.hide();
        }

        if ( this.applicationsButton ) {
            this.applicationsButton.container.show();
            this.applicationsButton._settingsChanged();
        }
        else {
            this.applicationsButton = new ApplicationsMenuButton();
            Main.panel.addToStatusArea('frippery-apps', this.applicationsButton,
                    0, 'left');
        }
    }

    disable() {
        let mode = Main.sessionMode.currentMode;
        if ( mode == 'classic' ) {
            return;
        }

        if ( this.applicationsButton ) {
            this.applicationsButton.container.hide();
        }

        if ( this.activitiesButton &&
                Main.sessionMode.panel.left.indexOf('activities') >= 0 ) {
            this.activitiesButton.container.show();
        }
    }
};

function init() {
    return new ApplicationsMenuExtension();
}
