const { Gio, GObject, Gtk } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;

const _f = imports.gettext.domain('frippery-applications-menu').gettext;

const SETTINGS_SHOW_ICON = "show-icon";
const SETTINGS_SHOW_TEXT = "show-text";

const ApplicationsMenuSettingsWidget = GObject.registerClass(
class ApplicationsMenuSettingsWidget extends Gtk.Grid {
    _init(params) {
        super._init(params);
        this.margin = 24;
        this.row_spacing = 6;
        this.column_spacing = 6;
        this.orientation = Gtk.Orientation.VERTICAL;
        this.settings = ExtensionUtils.getSettings();

        let check = new Gtk.CheckButton({ label: _f("Icon"), margin_top: 6 });
        this.settings.bind(SETTINGS_SHOW_ICON, check, 'active',
                Gio.SettingsBindFlags.DEFAULT);
        this.add(check);

        check = new Gtk.CheckButton({ label: _f("Text"), margin_top: 6 });
        this.settings.bind(SETTINGS_SHOW_TEXT, check, 'active',
                Gio.SettingsBindFlags.DEFAULT);
        this.add(check);
    }
});

function init() {
    ExtensionUtils.initTranslations();
}

function buildPrefsWidget() {
    let widget = new ApplicationsMenuSettingsWidget();
    widget.show_all();

    return widget;
}
