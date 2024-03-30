import type { Project, Event } from '@alilc/lowcode-shell';
import { IPublicTypeProjectSchema } from '@alilc/lowcode-types';
import { skeleton } from '@alilc/lowcode-engine';
import {
  beautifyCSS,
  compatGetSourceCodeMap,
  fileMapToTree,
  getConstructorContent,
  getDefaultDeclaration,
  getInitFuncContent,
  lintIndex,
  treeToMap,
} from './utils';
import { FunctionEventParams, Monaco, ObjectType } from './types';
import { common } from '@alilc/lowcode-engine';
import { editor } from 'monaco-editor';
import {
  addFunction,
  focusByFunctionName,
  focusCodeByContent,
  getDefaultFileList,
} from './MultipleFileEditor/util';
import { EditorContextType } from './Context';
import { Message } from '@alifd/next';
import { getMethods } from './utils/get-methods';
import { EditorHook, HookKeys } from './EditorHook';
import { PluginHooks, Service } from './Service';
import { MonacoSuggestions } from './MonacoSuggestions';

export * from './EditorHook';

export interface EditorControllerState {
  declarationsMap: Record<string, string>;
  extraLibs: { path: string; content: string }[];
}

export type HookHandleFn<T = any> = (fn: T) => () => void;

export interface CodeTemp {
  css: any;
  methods: any;
  state: any;
  lifeCycles: any;
  _sourceCodeMap: { files: ObjectType; meta: any };
}

export class EditorController extends EditorHook {
  editor!: Event;

  project!: Project;

  es6?: boolean;

  defaultFiles: ObjectType<string>;

  useLess?: boolean;

  public monaco?: Monaco;

  private codeTemp?: CodeTemp;

  private listeners: any[];

  private extraLibMap: Map<string, string>;

  private state: EditorControllerState;

  public codeEditor?: editor.IStandaloneCodeEditor;

  public codeEditorCtx?: EditorContextType;

  public service!: Service;

  private loadMonacoPromise?: Promise<any>;

  private monacoSuggestions: MonacoSuggestions;

  public onImportSchema: HookHandleFn<
    (schema: IPublicTypeProjectSchema) => void | Promise<void>
  > = this.hookFactory(HookKeys.onImport);

  public onSourceCodeChange: HookHandleFn<(code: any) => void> =
    this.hookFactory(HookKeys.onSourceCodeChange);

  public onEditCodeChange: HookHandleFn<
    (code: { content: string; file: string }) => void
  > = this.hookFactory(HookKeys.onEditCodeChange);

  public onMonacoLoaded: HookHandleFn<(monaco: Monaco) => void> =
    this.hookFactory(HookKeys.onMonacoLoaded);

  constructor() {
    super();
    this.state = {
      declarationsMap: {},
      extraLibs: [],
    };
    this.listeners = [];
    this.defaultFiles = {};
    this.extraLibMap = new Map();
    this.monacoSuggestions = new MonacoSuggestions(this);
  }

  async initMonaco() {
    if (!this.monaco) {
      if (!this.loadMonacoPromise) {
        const { getMonaco } = await import(
          '@alilc/lowcode-plugin-base-monaco-editor'
        );
        this.loadMonacoPromise = getMonaco();
      }
      this.monaco = await this.loadMonacoPromise;
      this.triggerHook(HookKeys.onMonacoLoaded, this.monaco);
      this.service.triggerHook(PluginHooks.onMonacoLoaded, this.monaco);
    }
  }

  init(project: Project, editor: Event, service: Service) {
    this.project = project;
    this.editor = editor;
    this.service = service;
    this.setupEventListeners();
    this.initCodeTempBySchema(this.getSchema(true));
    this.triggerHook(HookKeys.onImport, this.getSchema(true));
    this.initMonaco();
  }

  initCodeEditor(
    codeEditor: editor.IStandaloneCodeEditor,
    ctx: EditorContextType
  ) {
    this.codeEditor = codeEditor;
    this.codeEditorCtx = ctx;
    this.monacoSuggestions.init();
  }

  setCodeTemp(code: any | ((old: CodeTemp) => CodeTemp)) {
    if (typeof code === 'function') {
      this.codeTemp = code(this.codeTemp);
    } else {
      this.codeTemp = code;
    }
  }

  getCodeTemp(): CodeTemp | undefined {
    return this.codeTemp;
  }

  addComponentDeclaration(key: string, declaration: string) {
    this.state.declarationsMap[key] = declaration;
    this.publish();
    this.applyLibs();
  }

  addComponentDeclarations(list: [string, string][] = []) {
    for (const [key, dec] of list) {
      this.state.declarationsMap[key] = dec;
    }
    this.publish();
    this.applyLibs();
  }

  private publishExtraLib() {
    const libs: { path: string; content: string }[] = [];
    this.extraLibMap.forEach((content, path) => libs.push({ content, path }));
    this.state.extraLibs = libs;
    this.publish();
  }

  addExtraLib(content: string, path: string) {
    this.extraLibMap.set(path, content);
    this.applyLibs();
    this.publishExtraLib();
  }

  removeExtraLib(path: string) {
    this.extraLibMap.delete(path);
    this.applyLibs();
    this.publishExtraLib();
  }

  private async applyLibs() {
    if (!this.monaco) {
      await this.initMonaco();
    }
    const decStr = Object.keys(this.state.declarationsMap).reduce(
      (v, k) => `${v}\n${k}: ${this.state.declarationsMap[k]};\n`,
      ''
    );
    const { content, path } = getDefaultDeclaration(decStr);
    this.monaco?.languages.typescript.javascriptDefaults.addExtraLib(
      content,
      path
    );
    this.extraLibMap.forEach((value, key) => {
      this.monaco?.languages.typescript.javascriptDefaults.addExtraLib(
        value,
        key
      );
    });
  }

  getSchema(pure?: boolean): IPublicTypeProjectSchema {
    const schema = this.project.exportSchema(
      common.designerCabin.TransformStage.Save
    );
    // 导出的时候重新编译一下，避免没有打开编辑器的时候直接保存值没有编译代码的情况
    const fileMap = this.codeEditorCtx?.fileTree
      ? treeToMap(this.codeEditorCtx.fileTree)
      : this.codeTemp?._sourceCodeMap.files; // 获取最新的fileMap
    if (fileMap && !pure) {
      try {
        if (!this.compileSourceCode(fileMap)) {
          // 下面会导致整个页面挂掉，先作为弱依赖，给个提示
          throw new Error('编译失败');
        }
        Object.assign(schema.componentsTree[0], this.codeTemp);
      } catch (error) {
        console.error(error);
        Message.error('源码编译失败，请返回修改');
      }
    }
    return schema;
  }

  importSchema(schema: IPublicTypeProjectSchema) {
    this.project.importSchema(schema);
    this.initCodeTempBySchema(schema);
    this.triggerHook(HookKeys.onImport, schema);
    // 文件树发生改变
    this.triggerHook(
      HookKeys.onSourceCodeChange,
      (schema as any).componentsTree[0]?._sourceCodeMap
    );
  }

  publish(state?: any) {
    this.state = {
      ...this.state,
      ...state,
    };
    this.listeners.forEach((l) => l(this.state));
  }

  subscribe(fn: (state: EditorControllerState) => any) {
    this.listeners.push(fn);
    fn(this.state);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  public initCodeTempBySchema(schema: IPublicTypeProjectSchema) {
    const componentSchema = schema.componentsTree[0] || {};
    const { css, methods, state, lifeCycles } = componentSchema as any;
    const codeMap = (componentSchema as any)._sourceCodeMap;
    const defaultFileMap = {
      ...this.defaultFiles,
      ...getDefaultFileList(schema, this.useLess),
    };
    const compatMap = compatGetSourceCodeMap(codeMap, defaultFileMap);
    this.codeTemp = {
      css,
      methods,
      state,
      lifeCycles,
      _sourceCodeMap: {
        ...compatMap,
      },
    };
  }

  private setupEventListeners() {
    this.editor?.on('common:codeEditor.focusByFunction', ((
      params: FunctionEventParams
    ) => {
      setTimeout(() => {
        this.codeEditorCtx?.selectFile('index.js', []);
        if (this.monaco && this.codeEditor) {
          focusByFunctionName(this.codeEditor, params, this.monaco);
        }
      }, 100);
    }) as any);

    this.editor?.on('common:codeEditor.addFunction', ((
      params: FunctionEventParams
    ) => {
      this.codeEditorCtx?.selectFile('index.js', []);
      setTimeout(() => {
        if (this.monaco && this.codeEditor) {
          addFunction(this.codeEditor, params, this.monaco);
        }
      }, 100);
    }) as any);
  }

  focusCodeByPosition(file: string, pos: { line: number; col?: number }) {
    skeleton.showPanel('codeEditor');
    setTimeout(() => {
      this.codeEditorCtx?.selectFileByName(file);
      setTimeout(() => {
        if (this.codeEditor) {
          this.codeEditor.revealLineInCenter(pos.line);
          this.codeEditor.setPosition({
            column: pos.col || 0,
            lineNumber: pos.line,
          });
          this.codeEditor.focus();
        }
      }, 100);
    }, 100);
  }

  focusCode(file: string, content: string) {
    skeleton.showPanel('codeEditor');
    setTimeout(() => {
      this.codeEditorCtx?.selectFileByName(file);
      if (this.codeEditor && this.monaco) {
        focusCodeByContent(this.codeEditor, this.monaco, content);
      }
    }, 100);
  }

  // 编译并保存源码
  compileSourceCode(fileMap: any, softSave = true) {
    const { valid, validMsg } = lintIndex(fileMap['index.js']);
    if (!valid) {
      Message.error(validMsg);
      return false;
    }
    const { methods, lifeCycles, state } = getMethods(fileMap['index.js']);
    const schema = this.getSchema(true);
    const pageNode: any = {};
    pageNode._sourceCodeMap = {
      files: fileMap,
      meta: this.getCodeTemp()?._sourceCodeMap?.meta || {},
    };
    pageNode.state = state;
    pageNode.methods = methods;
    pageNode.lifeCycles = lifeCycles;
    const lessContent = fileMap['index.less'];
    // 没有less文件，走之前的逻辑
    if (!lessContent) {
      pageNode.css = beautifyCSS(fileMap['index.css'] || '', {});
    }
    if (this.useLess && lessContent) {
      window.less?.render(lessContent, {}, (err: any, output: any) => {
        if (err) {
          Message.error('less 编译失败');
          console.error(err);
        }
        pageNode.css = output?.css || '';
      });
    }
    if (lifeCycles.constructor === {}.constructor) {
      lifeCycles.constructor = {
        originalCode: 'function constructor() { }',
        type: 'JSFunction',
        value: 'function constructor() { }',
      } as any;
    }
    // 编译工具函数
    (lifeCycles as any).constructor.value = getConstructorContent(
      (lifeCycles.constructor as any).value as any
    );
    pageNode.methods.__initExtra = {
      type: 'JSFunction',
      value: getInitFuncContent(fileMap, this.es6),
    };
    if (softSave) {
      (window as any).__lowcode__source__code__ = {
        css: pageNode.css,
        methods: pageNode.methods,
        state: pageNode.state,
        lifeCycles: pageNode.lifeCycles,
        _sourceCodeMap: pageNode._sourceCodeMap,
      };
      this.setCodeTemp((window as any).__lowcode__source__code__);
    } else {
      if (schema.componentsTree[0]) {
        Object.assign(schema.componentsTree[0], pageNode);
      }
      this.project.importSchema(schema);
      Message.success('保存成功');
    }
    return true;
  }

  public resetSaveStatus() {
    this.codeEditorCtx?.updateState({ modifiedKeys: [] });
  }

  // 添加一堆文件
  public addFiles(fileMap: ObjectType<string>) {
    if (!Object.keys(fileMap || {}).length || !this.codeEditorCtx?.fileTree) {
      return;
    }
    const subTree = fileMapToTree(fileMap);
    const { files, dirs } = subTree;
    const newTree = { ...this.codeEditorCtx?.fileTree };
    newTree.files?.push(...files);
    newTree.dirs?.push(...dirs);
    this.codeEditorCtx.updateState({
      fileTree: newTree,
    });
  }

  triggerHook(key: HookKeys, ...args: any[]): void {
    super.triggerHook(key, ...args);
  }
}

export const editorController = new EditorController();
