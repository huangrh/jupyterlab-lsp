import { WidgetAdapter } from '../adapter';
import { Notebook, NotebookPanel } from '@jupyterlab/notebook';
import { VirtualCodeMirrorNotebookEditor } from '../../virtual/editors/notebook';
import { until_ready } from '../../utils';
import { language_specific_overrides } from '../../magics/defaults';
import { foreign_code_extractors } from '../../extractors/defaults';
import { Cell } from '@jupyterlab/cells';
import * as nbformat from '@jupyterlab/nbformat';
import ILanguageInfoMetadata = nbformat.ILanguageInfoMetadata;
import { Session } from '@jupyterlab/services';
import { SessionContext } from '@jupyterlab/apputils';
import { LSPExtension } from '../../index';
import { PositionConverter } from "../../converter";
import { IEditorPosition } from "../../positioning";
import { ICommandContext } from "../../command_manager";
import { IVirtualEditor } from "../../virtual/editor";
import { CodeEditor } from '@jupyterlab/codeeditor';
import IEditor = CodeEditor.IEditor;
import { VirtualDocument } from "../../virtual/document";

export class NotebookAdapter extends WidgetAdapter<NotebookPanel> {
  editor: Notebook;
  virtual_editor: IVirtualEditor<IEditor>;

  private _language_info: ILanguageInfoMetadata;

  constructor(extension: LSPExtension, editor_widget: NotebookPanel) {
    super(extension, editor_widget);
    this.editor = editor_widget.content;
    this.init_once_ready().catch(console.warn);
  }

  private async update_language_info() {
    this._language_info = (
      await this.widget.context.sessionContext.session.kernel.info
    ).language_info;
  }

  async on_kernel_changed(
    _session: SessionContext,
    change: Session.ISessionConnection.IKernelChangedArgs
  ) {
    if (!change.newValue) {
      console.log('LSP: kernel was shut down');
      return;
    }
    try {
      await this.update_language_info();
      console.log(
        `LSP: Changed to ${this._language_info.name} kernel, reconnecting`
      );
      await until_ready(this.is_ready, -1);
      this.reload_connection();
    } catch (err) {
      console.warn(err);
      // try to reconnect anyway
      this.reload_connection();
    }
  }

  dispose() {
    if (this.isDisposed) {
      return;
    }
    this.widget.context.sessionContext.kernelChanged.disconnect(
      this.on_kernel_changed,
      this
    );
    this.widget.content.activeCellChanged.disconnect(
      this.activeCellChanged,
      this
    );
    super.dispose();
  }

  is_ready = () => {
    return (
      !this.widget.isDisposed &&
      this.widget.context.isReady &&
      this.widget.content.isVisible &&
      this.widget.content.widgets.length > 0 &&
      this.widget.context.sessionContext.session?.kernel != null
    );
  };

  get document_path(): string {
    return this.widget.context.path;
  }

  protected language_info(): ILanguageInfoMetadata {
    return this._language_info;
  }

  get mime_type(): string {
    let language_metadata = this.language_info();
    if (!language_metadata) {
      // fallback to the code cell mime type if no kernel in use
      return this.widget.content.codeMimetype;
    }
    return language_metadata.mimetype;
  }

  get language_file_extension(): string {
    let language_metadata = this.language_info();
    if (!language_metadata) {
      return null;
    }
    return language_metadata.file_extension.replace('.', '');
  }

  async init_once_ready() {
    console.log('LSP: waiting for', this.document_path, 'to fully load');
    await this.widget.context.sessionContext.ready;
    await until_ready(this.is_ready, -1);
    await this.update_language_info();
    console.log('LSP:', this.document_path, 'ready for connection');

    let virtual_document = this.create_virtual_document();

    this.virtual_editor = new VirtualCodeMirrorNotebookEditor(
      this.widget.content,
      this.widget.node,
      virtual_document
    );
    this.connect_contentChanged_signal();

    // connect the document, but do not open it as the adapter will handle this
    // after registering all features
    this.connect_document(this.virtual_editor.virtual_document, false).catch(
      console.warn
    );

    this.widget.context.sessionContext.kernelChanged.connect(
      this.on_kernel_changed,
      this
    );

    this.widget.content.activeCellChanged.connect(this.activeCellChanged, this);
  }

  create_virtual_document() {
    return new VirtualDocument( {
      language: this.language,
      path: this.document_path,
      overrides_registry: language_specific_overrides,
      foreign_code_extractors: foreign_code_extractors,
      file_extension: this.language_file_extension,
      // notebooks are continuous, each cell is dependent on the previous one
      standalone: false,
      // notebooks are not supported by LSP servers
      has_lsp_supported_file: false
      }
    );
  }

  get activeEditor() {
    return this.widget.content.activeCell.editor;
  }

  private activeCellChanged(notebook: Notebook, cell: Cell) {
    this.activeEditorChanged.emit({
      editor: cell.editor
    });
  }

  context_from_active_document(): ICommandContext | null {
    let cell = this.widget.content.activeCell;
    let editor = cell.editor;
    let ce_cursor = editor.getCursorPosition();
    let cm_cursor = PositionConverter.ce_to_cm(ce_cursor) as IEditorPosition;

    let virtual_editor = this?.virtual_editor;

    if (virtual_editor == null) {
      return null;
    }

    let root_position = virtual_editor.transform_from_editor_to_root(
      editor,
      cm_cursor
    );

    if (root_position == null) {
      console.warn('Could not retrieve current context', virtual_editor);
      return null;
    }

    return this?.get_context(root_position);
  }
}