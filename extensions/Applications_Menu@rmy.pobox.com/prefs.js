// Copyright (C) 2015-2021 R M Yorston
// Licence: GPLv2+

const { Gio, GObject, Gtk } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;

const _f = imports.gettext.domain('frippery-applications-menu').gettext;

const SETTINGS_SHOW_ICON = "show-icon";
const SETTINGS_SHOW_TEXT = "show-text";

const ApplicationsMenuSettingsWidget = GObject.registerClass(
class ApplicationsMenuSettingsWidget extends Gtk.Grid {
    _init(params) {
        super._init({
            halign: Gtk.Align.CENTER,
            margin_top: 24,
            margin_bottom: 24,
            margin_start: 24,
            margin_end: 24,
            column_spacing: 12,
            row_spacing: 6,
        });
        this.settings = ExtensionUtils.getSettings();

        let check = new Gtk.CheckButton({ label: _f("Icon"), margin_top: 6 });
        this.settings.bind(SETTINGS_SHOW_ICON, check, 'active',
                Gio.SettingsBindFlags.DEFAULT);
        this.attach(check, 0, 0, 1, 1);

        check = new Gtk.CheckButton({ label: _f("Text"), margin_top: 6 });
        this.settings.bind(SETTINGS_SHOW_TEXT, check, 'active',
                Gio.SettingsBindFlags.DEFAULT);
        this.attach(check, 0, 1, 1, 1);
    }
});

function init() {
    ExtensionUtils.initTranslations();
}

function buildPrefsWidget() {
    return new ApplicationsMenuSettingsWidget();
}
