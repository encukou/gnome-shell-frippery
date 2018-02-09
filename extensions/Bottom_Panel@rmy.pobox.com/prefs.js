const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const GObject = imports.gi.GObject;
const Lang = imports.lang;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

const _f = imports.gettext.domain('frippery-bottom-panel').gettext;

const OVERRIDES_SCHEMA = 'org.gnome.shell.overrides';
const WM_SCHEMA = 'org.gnome.desktop.wm.preferences';

const SETTINGS_NUM_ROWS = 'num-rows';
const SETTINGS_SHOW_PANEL = 'show-panel';
const SETTINGS_DYNAMIC_WORKSPACES = 'dynamic-workspaces';
const SETTINGS_NUM_WORKSPACES = 'num-workspaces';

const BottomPanelSettingsWidget = new GObject.Class({
	Name: 'BottomPanel.Prefs.BottomPanelSettingsWidget',
    GTypeName: 'BottomPanelSettingsWidget',
    Extends: Gtk.Grid,

    _init : function(params) {
        this.parent(params);
        this.margin = 24;
        this.row_spacing = 6;
        this.column_spacing = 12;
        this.orientation = Gtk.Orientation.VERTICAL;

        // preferences come from all over the place
        this.settings = Convenience.getSettings();
        this.or_settings = new Gio.Settings({ schema: OVERRIDES_SCHEMA });
        this.wm_settings = new Gio.Settings({ schema: WM_SCHEMA });

        // number of workspaces (from window manager preferences)
        this.attach(new Gtk.Label({ label: _f('Number of Workspaces'),
                                    halign: Gtk.Align.END }), 0, 0, 1, 1);
        let adjustment = new Gtk.Adjustment({ lower: 1, upper: 32,
                                    step_increment: 1 });
        let spin = new Gtk.SpinButton({ adjustment: adjustment,
                        snap_to_ticks: true });
        let n_workspaces = this.wm_settings.get_int(SETTINGS_NUM_WORKSPACES);
        spin.set_value(n_workspaces);
        this.attach(spin, 1, 0, 1, 1);
        spin.connect('value-changed', Lang.bind(this, function(widget) {
            this.wm_settings.set_int(SETTINGS_NUM_WORKSPACES, widget.get_value());
        }));

        // number of rows (from bottom panel preferences)
        let nrows = this.settings.get_int(SETTINGS_NUM_ROWS);
        this.attach(new Gtk.Label({ label: _f('Rows in workspace switcher'),
                                    halign: Gtk.Align.END }), 0, 1, 1, 1);
        let adjustment = new Gtk.Adjustment({ lower: 1, upper: 5,
                                    step_increment: 1 });
        spin = new Gtk.SpinButton({ adjustment: adjustment,
                        snap_to_ticks: true });
        spin.set_value(nrows);
        this.attach(spin, 1, 1, 1, 1);
        spin.connect('value-changed', Lang.bind(this, function(widget) {
            this.settings.set_int(SETTINGS_NUM_ROWS, widget.get_value());
        }));

        // dynamic workspaces (from shell overrides)
        let check = new Gtk.CheckButton({ label: _f('Dynamic workspaces'),
                                    margin_top: 6 });
        this.or_settings.bind(SETTINGS_DYNAMIC_WORKSPACES, check, 'active',
                Gio.SettingsBindFlags.DEFAULT);
        this.attach(check, 0, 2, 2, 1);

        // show panel (from bottom panel preferences)
        let label = new Gtk.Label({ label: _f('Panel visible in workspace'),
                                 margin_bottom: 6, margin_top: 6,
                                 halign: Gtk.Align.START });
        this.attach(label, 0, 3, 2, 1);

        let align = new Gtk.Alignment({ left_padding: 12 });
        this.add(align);

        let grid = new Gtk.Grid({ orientation: Gtk.Orientation.VERTICAL,
                                  row_spacing: 6,
                                  column_spacing: 6 });
        align.add(grid);

        let show_panel = this.settings.get_value(SETTINGS_SHOW_PANEL).deep_unpack();
        show_panel[0] = true;
        if ( show_panel.length < n_workspaces ) {
            for ( let i=show_panel.length; i<n_workspaces; ++i ) {
                show_panel[i] = true;
            }
        }

        let ncols = Math.floor(n_workspaces/nrows);
        if ( n_workspaces%nrows != 0 ) {
            ++ncols;
        }

        this.check = [];
        for ( let r=0; r<nrows; ++r ) {
            for ( let c=0; c<ncols; ++c ) {
                let i = r*ncols + c;
                if ( i < n_workspaces ) {
                    this.check[i] = new Gtk.CheckButton();
                    this.check[i].set_active(show_panel[i]);
                    this.check[i].set_sensitive(i != 0);
                    grid.attach(this.check[i], c, r, 1, 1);
                    this.check[i].connect('toggled',
                            Lang.bind(this, this._updatePanel));
                }
            }
        }
    },

    _updatePanel: function(widget) {
        let show_panel = [];
        show_panel[0] = true;
        for ( let i=1; i<this.check.length; ++i ) {
            show_panel[i] = this.check[i].get_active();
        }

        let value = GLib.Variant.new('ab', show_panel);
        this.settings.set_value(SETTINGS_SHOW_PANEL, value);
    }
});

function init() {
    Convenience.initTranslations();
}

function buildPrefsWidget() {
    let widget = new BottomPanelSettingsWidget();
    widget.show_all();

    return widget;
}
