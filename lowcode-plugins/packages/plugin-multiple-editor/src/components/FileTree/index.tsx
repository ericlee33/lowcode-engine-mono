import React, { CSSProperties, FC, useCallback, useRef, useState } from 'react';
import { Form, Input, Dialog, Message } from '@alifd/next';
import cls from 'classnames';
import { Dir, File, getFileOrDirTarget } from '../../utils/files';
import TreeNode, {
  HandleAddFn,
  HandleChangeFn,
  HandleDeleteFn,
  HandleRenameFn,
} from './TreeNode';
import './index.less';
import { useEditorContext } from '../../Context';
import fullscreenIcon from './img/fullscreen.svg';
import fullscreenExitIcon from './img/fullscreen-exit.svg';
import compileIcon from './img/compile.svg';
import { PluginAction } from '@/Service';

export interface FileTreeProps {
  dir?: Dir;
  mode?: 'single' | 'multiple';
  onChange?: HandleChangeFn;
  className?: string;
  onSave?: () => any;
  onFullscreen?: (enable: boolean) => void;
  fullscreen?: boolean;
  actions?: PluginAction[];
}

const defaultDir = new Dir('/', [], [], '');

function validate(
  data: { type: string; path: any },
  name: string,
  fileTree: any
) {
  const { type, path } = data;
  if (/\\|\//.test(name)) {
    return '非法命名';
  }
  if (name === 'modules') {
    return 'modules 为内置关键字，不允许使用';
  }
  const finalNode: Dir | undefined = getFileOrDirTarget(fileTree, path);
  if (finalNode) {
    const targetDir: any[] =
      type === 'file' ? finalNode?.files : finalNode.dirs;
    if (targetDir.find((t: any) => t.name === name)) {
      return '文件或文件夹已存在';
    }
  }
  if (data.type === 'file' && name.endsWith('.less') && name !== 'index.less') {
    return 'less 文件仅支持创建 index.less';
  }
  if (data.type === 'file') {
    return name && /\.(js|less)$/.test(name)
      ? undefined
      : '文件名必填且未js后缀';
  }
}

const newModalStyle: CSSProperties = {
  width: 380,
};

const FileTree: FC<FileTreeProps> = ({
  dir = defaultDir,
  onChange,
  className,
  onSave,
  onFullscreen,
  fullscreen,
  mode,
  actions,
}) => {
  const { updateFileTreeByPath, fileTree, modifiedKeys, currentFile } =
    useEditorContext();
  const [visible, setVisible] = useState(false);
  const [value, setValue] = useState({ name: '' });
  const tmp = useRef<{
    path: string[];
    type: string;
    fullPath: string;
    operation?: string;
    target?: any;
  }>({} as any).current;
  const handleAdd = useCallback<HandleAddFn>(
    (type, path) => {
      tmp.operation = 'add';
      tmp.path = path;
      tmp.type = type;
      setValue({ name: '' });
      setVisible(true);
    },
    [tmp]
  );
  const handleRename = useCallback<HandleRenameFn>(
    (type, path, target) => {
      tmp.target = target;
      tmp.operation = 'rename';
      tmp.path = path;
      tmp.type = type;
      setValue({ name: '' });
      setVisible(true);
    },
    [tmp]
  );
  const handleClose = useCallback(() => {
    setVisible(false);
  }, []);

  const handleChange = useCallback((v: string) => {
    setValue({ name: v });
  }, []);

  const handleEditFileToTree = useCallback(
    async (e?: React.KeyboardEvent<HTMLInputElement>) => {
      if (e && !(e.key === 'Enter' || e?.keyCode === 13)) {
        return;
      }
      const { name } = value;
      const validMsg = validate(tmp, name, fileTree);
      if (!validMsg) {
        const fullPath = `${tmp.path}/${name}`;
        if (tmp.operation === 'rename') {
          updateFileTreeByPath(tmp.path, tmp.target, 'rename', name);
        } else {
          const target =
            tmp.type === 'file'
              ? new File(name, '', fullPath)
              : new Dir(name, [], [], fullPath);
          updateFileTreeByPath(tmp.path, target, 'add');
        }
        setVisible(false);
      } else {
        Message.error(validMsg);
      }
    },
    [fileTree, tmp, updateFileTreeByPath, value]
  );

  const handleDelete = useCallback<HandleDeleteFn>(
    (path, target) => {
      Dialog.confirm({
        title: '确定删除？',
        onOk() {
          updateFileTreeByPath(path, target, 'delete');
        },
      });
    },
    [updateFileTreeByPath]
  );
  let title = tmp.type === 'file' ? '新建文件' : '新建文件夹';
  if (tmp.operation === 'rename') {
    title = tmp.type === 'file' ? '重命名文件' : '重命名文件夹';
  }
  return (
    <div className={cls('ilp-file-bar', className)}>
      <h4 className="ilp-file-bar-title">
        <span>文件目录</span>
        <span>
          <img
            src={fullscreen ? fullscreenExitIcon : fullscreenIcon}
            alt={fullscreen ? '退出全屏' : '全屏'}
            title={fullscreen ? '退出全屏' : '全屏'}
            onClick={() => onFullscreen?.(!fullscreen)}
          />
          <img
            src={compileIcon}
            alt="编译代码"
            title="编译代码"
            onClick={onSave}
          />
          {actions?.map((item) => (
            <span
              className="ilp-tree-action-item"
              key={item.key}
              title={item.title}
              onClick={item.action}
            >
              {item.icon}
            </span>
          ))}
        </span>
      </h4>

      <TreeNode
        dir={dir}
        className={mode === 'single' ? 'ilp-file-tree-single' : ''}
        disableAction={mode === 'single'}
        onChange={onChange}
        onAdd={handleAdd}
        onDelete={handleDelete}
        onRename={handleRename}
        modifiedKeys={modifiedKeys}
        selectedKey={currentFile.file?.fullPath}
      />

      <Dialog
        style={newModalStyle}
        title={title}
        visible={visible}
        onCancel={handleClose}
        onClose={handleClose}
        onOk={() => handleEditFileToTree()}
      >
        <Form>
          <Form.Item
            label={tmp.type === 'file' ? '文件名' : '文件夹名'}
            name="name"
            required
            requiredMessage="必填"
          >
            <Input
              autoFocus
              value={value.name}
              onChange={handleChange}
              onKeyDown={(e) => handleEditFileToTree(e)}
            />
          </Form.Item>
        </Form>
      </Dialog>
    </div>
  );
};

export default FileTree;
