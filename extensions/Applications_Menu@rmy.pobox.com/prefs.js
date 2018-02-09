const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const GObject = imports.gi.GObject;
const Lang = imports.lang;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

const _f = imports.gettext.domain('frippery-applications-menu').gettext;

const SETTINGS_SHOW_ICON = "show-icon";
const SETTINGS_SHOW_TEXT = "show-text";
const SETTINGS_ENABLE_HOT_CORNER = "enable-hot-corner";

const ApplicationsMenuSettingsWidget = new GObject.Class({
	Name: 'ApplicationsMenu.Prefs.ApplicationsMenuSettingsWidget',
    GTypeName: 'ApplicationsMenuSettingsWidget',
    Extends: Gtk.Grid,

    _init : function(params) {
        this.parent(params);
        this.margin = 24;
        this.row_spacing = 6;
        this.column_spacing = 6;
        this.orientation = Gtk.Orientation.VERTICAL;
        this.settings = Convenience.getSettings();

        let check = new Gtk.CheckButton({ label: _f("Icon"), margin_top: 6 });
        this.settings.bind(SETTINGS_SHOW_ICON, check, 'active',
                Gio.SettingsBindFlags.DEFAULT);
        this.add(check);

        check = new Gtk.CheckButton({ label: _f("Text"), margin_top: 6 });
        this.settings.bind(SETTINGS_SHOW_TEXT, check, 'active',
                Gio.SettingsBindFlags.DEFAULT);
        this.add(check);

        check = new Gtk.CheckButton({ label: _f("Hot corner"), margin_top: 6 });
        this.settings.bind(SETTINGS_ENABLE_HOT_CORNER, check, 'active',
                Gio.SettingsBindFlags.DEFAULT);
        this.add(check);
    }
});

function init() {
    Convenience.initTranslations();
}

function buildPrefsWidget() {
    let widget = new ApplicationsMenuSettingsWidget();
    widget.show_all();

    return widget;
}
