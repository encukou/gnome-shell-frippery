// Copyright (C) 2015-2019 R M Yorston
// Licence: GPLv2+

/* stolen from the workspace-indicator extension */
const { Gio, GObject, Gtk } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;

const _f = imports.gettext.domain('frippery-panel-favorites').gettext;

const SETTINGS_FAVORITES_ENABLED = 'favorites-enabled';
const SETTINGS_FAVORITES_POSITION = 'favorites-position';
const SETTINGS_OTHER_APPS_ENABLED = 'other-apps-enabled';
const SETTINGS_OTHER_APPS_POSITION = 'other-apps-position';
const SETTINGS_OTHER_APPS = 'other-apps';

const AppsModel = GObject.registerClass(
class AppsModel extends Gtk.ListStore {
    _init(params) {
        super._init(params);
        this.set_column_types([GObject.TYPE_STRING]);

        this.Columns = {
            LABEL: 0,
        };

        this._settings = ExtensionUtils.getSettings();

        this._reloadFromSettings();

        // overriding class closure doesn't work, because GtkTreeModel
        // plays tricks with marshallers and class closures
        this.connect('row-changed', this._onRowChanged.bind(this));
        this.connect('row-inserted', this._onRowInserted.bind(this));
        this.connect('row-deleted', this._onRowDeleted.bind(this));
    }

    _reloadFromSettings() {
        if (this._preventChanges)
            return;
        this._preventChanges = true;

        let newNames = this._settings.get_strv(SETTINGS_OTHER_APPS);

        let i = 0;
        let [ok, iter] = this.get_iter_first();
        while (ok && i < newNames.length) {
            this.set(iter, [this.Columns.LABEL], [newNames[i]]);

            ok = this.iter_next(iter);
            i++;
        }

        while (ok)
            ok = this.remove(iter);

        for ( ; i < newNames.length; i++) {
            iter = this.append();
            this.set(iter, [this.Columns.LABEL], [newNames[i]]);
        }

        this._preventChanges = false;
    }

    _onRowChanged(self, path, iter) {
        if (this._preventChanges)
            return;
        this._preventChanges = true;

        let index = path.get_indices()[0];
        let names = this._settings.get_strv(SETTINGS_OTHER_APPS);

        if (index >= names.length) {
            // fill with blanks
            for (let i = names.length; i <= index; i++)
                names[i] = '';
        }

        names[index] = this.get_value(iter, this.Columns.LABEL);

        this._settings.set_strv(SETTINGS_OTHER_APPS, names);

        this._preventChanges = false;
    }

    _onRowInserted(self, path, iter) {
        if (this._preventChanges)
            return;
        this._preventChanges = true;

        let index = path.get_indices()[0];
        let names = this._settings.get_strv(SETTINGS_OTHER_APPS);
        let label = this.get_value(iter, this.Columns.LABEL) || '';
        names.splice(index, 0, label);

        this._settings.set_strv(SETTINGS_OTHER_APPS, names);

        this._preventChanges = false;
    }

    _onRowDeleted(self, path) {
        if (this._preventChanges)
            return;
        this._preventChanges = true;

        let index = path.get_indices()[0];
        let names = this._settings.get_strv(SETTINGS_OTHER_APPS);

        if (index >= names.length)
            return;

        names.splice(index, 1);

        // compact the array
        for (let i = names.length -1; i >= 0 && !names[i]; i++)
            names.pop();

        this._settings.set_strv(SETTINGS_OTHER_APPS, names);

        this._preventChanges = false;
    }
});

const PanelFavoritesSettingsWidget = GObject.registerClass(
class PanelFavoritesSettingsWidget extends Gtk.Grid {
    _init(params) {
        super._init(params);
        this.margin = 12;
        this.orientation = Gtk.Orientation.VERTICAL;
        this._settings = ExtensionUtils.getSettings();

        this.add(new Gtk.Label({
                    label: '<b>' + _f("Favorites") + '</b>',
                    use_markup: true, margin_bottom: 6,
                    hexpand: true, halign: Gtk.Align.START }));

        let align = new Gtk.Alignment({ left_padding: 12 });
        this.add(align);

        let grid = new Gtk.Grid({ orientation: Gtk.Orientation.VERTICAL,
                                  row_spacing: 6,
                                  column_spacing: 6 });
        align.add(grid);

        let state = this._settings.get_boolean(SETTINGS_FAVORITES_ENABLED);
        let check = new Gtk.CheckButton({ label: _f("Enable"),
                                          active: state,
                                          margin_top: 6 });
        this._settings.bind(SETTINGS_FAVORITES_ENABLED, check,                                             'active', Gio.SettingsBindFlags.DEFAULT);
        grid.add(check);

        let box = new Gtk.HBox();
        grid.add(box);

        box.pack_start(new Gtk.Label({ label: _f("Position"),
                                       halign: Gtk.Align.START }),
                        false, true, 6);

        state = this._settings.get_boolean(SETTINGS_FAVORITES_POSITION);
        let radio = null;
        radio = new Gtk.RadioButton({ active: !state,
                                      label: _f('Left'),
                                      group: radio });
        box.pack_start(radio, false, true, 6);

        radio = new Gtk.RadioButton({ active: state,
                                      label: _f('Right'),
                                      group: radio });
        this._settings.bind(SETTINGS_FAVORITES_POSITION, radio, 'active',
                            Gio.SettingsBindFlags.DEFAULT);
        radio.set_active(state);
        box.pack_start(radio, false, true, 6);


        this.add(new Gtk.Label({
                    label: '<b>' + _f("Other Applications") + '</b>',
                    use_markup: true, margin_bottom: 6, margin_top: 12,
                    hexpand: true, halign: Gtk.Align.START }));

        align = new Gtk.Alignment({ left_padding: 12 });
        this.add(align);

        grid = new Gtk.Grid({ orientation: Gtk.Orientation.VERTICAL,
                                  row_spacing: 6,
                                  column_spacing: 6 });
        align.add(grid);

        state = this._settings.get_boolean(SETTINGS_OTHER_APPS_ENABLED);
        check = new Gtk.CheckButton({ label: _f("Enable"),
                                      active: state,
                                      margin_top: 6 });
        this._settings.bind(SETTINGS_OTHER_APPS_ENABLED, check, 'active',
                            Gio.SettingsBindFlags.DEFAULT);
        grid.add(check);

        box = new Gtk.HBox();
        grid.add(box);

        box.pack_start(new Gtk.Label({
                    label: _f("Position"),
                    halign: Gtk.Align.START }),
                    false, true, 6);

        state = this._settings.get_boolean(SETTINGS_OTHER_APPS_POSITION);
        radio = null;
        radio = new Gtk.RadioButton({ active: !state,
                                      label: _f('Left'),
                                      group: radio });
        box.pack_start(radio, false, true, 6);

        radio = new Gtk.RadioButton({ active: state,
                                      label: _f('Right'),
                                      group: radio });
        this._settings.bind(SETTINGS_OTHER_APPS_POSITION, radio, 'active',
                            Gio.SettingsBindFlags.DEFAULT);
        radio.set_active(state);
        box.pack_start(radio, false, true, 6);

        let scrolled = new Gtk.ScrolledWindow({ shadow_type: Gtk.ShadowType.IN });
        scrolled.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);
        grid.add(scrolled);

        this._store = new AppsModel();
        this._treeView = new Gtk.TreeView({ model: this._store,
                                            headers_visible: false,
                                            reorderable: true,
                                            hexpand: true,
                                            vexpand: true
                                          });

        let column = new Gtk.TreeViewColumn({ title: _f("Launcher") });
        let renderer = new Gtk.CellRendererText({ editable: true });
        renderer.connect('edited', this._cellEdited.bind(this));
        column.pack_start(renderer, true);
        column.add_attribute(renderer, 'text', this._store.Columns.LABEL);
        this._treeView.append_column(column);

        scrolled.add(this._treeView);

        let toolbar = new Gtk.Toolbar({ icon_size: Gtk.IconSize.SMALL_TOOLBAR });
        toolbar.get_style_context().add_class(Gtk.STYLE_CLASS_INLINE_TOOLBAR);

        let newButton = new Gtk.ToolButton({ icon_name: 'list-add-symbolic' });
        newButton.connect('clicked', this._newClicked.bind(this));
        toolbar.add(newButton);

        let delButton = new Gtk.ToolButton({ icon_name: 'list-remove-symbolic' });
        delButton.connect('clicked', this._delClicked.bind(this));
        toolbar.add(delButton);

        let selection = this._treeView.get_selection();
        selection.connect('changed',
            function() {
                delButton.sensitive = selection.count_selected_rows() > 0;
            });
        delButton.sensitive = selection.count_selected_rows() > 0;

        grid.add(toolbar);
    }

    _cellEdited(renderer, path, new_text) {
        let [ok, iter] = this._store.get_iter_from_string(path);

        if (ok)
            this._store.set(iter, [this._store.Columns.LABEL], [new_text]);
    }

    _newClicked() {
        let iter = this._store.append();
        let index = this._store.get_path(iter).get_indices()[0];

        let label = "dummy.desktop";
        this._store.set(iter, [this._store.Columns.LABEL], [label]);
    }

    _delClicked() {
        let [any, model, iter] = this._treeView.get_selection().get_selected();

        if (any)
            this._store.remove(iter);
    }
});

function init() {
    ExtensionUtils.initTranslations();
}

function buildPrefsWidget() {
    let widget = new PanelFavoritesSettingsWidget();
    widget.show_all();

    return widget;
}
