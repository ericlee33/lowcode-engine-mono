
import { Visitor } from '@babel/traverse';
import * as BabelTypes from "@babel/types";
import template from '@babel/template';

interface IMeta {
  pluginName: string;
  meta: any;
};

interface IVisitorPass {
  opts?: {
    filename: string;
    meta?: IMeta;
  }
  filename?: string;
}

interface IInjectVisitorPass extends IVisitorPass {
  declarationName: string;
  meta?: IMeta;
  cache: {
    pluginNameAssignmentExists: boolean;
    metaAssignmentExists: boolean;
  }
}

const addInfoComment = (node) => {
  BabelTypes.addComment(node, 'leading', ' Generated By Ali Lowcode Tools ');
}


const injectMetaVisitor: Visitor<IInjectVisitorPass> = {
  AssignmentExpression(path, pass) {
    const left = path.node.left;
    if (BabelTypes.isMemberExpression(left) && BabelTypes.isIdentifier(left.object) && left.object.name === pass.declarationName) {
      const property = left.property;
      if (
        (BabelTypes.isIdentifier(property) && property.name === 'pluginName') ||
        (BabelTypes.isStringLiteral(property) && property.value === 'pluginName')
      ) {
        const meta = pass.meta;
        pass.cache.pluginNameAssignmentExists = true;
        if (meta?.pluginName) {
          path.node.right = BabelTypes.stringLiteral(meta.pluginName);
          addInfoComment(path.node);
        }
      }
      if (
        (BabelTypes.isIdentifier(property) && property.name === 'meta') ||
        (BabelTypes.isStringLiteral(property) && property.value === 'meta')
      ) {
        const meta = pass.meta;
        pass.cache.metaAssignmentExists = true;
        if (meta?.meta) {
          const generateAst = template(`const a = ${JSON.stringify(meta.meta)}`)() as BabelTypes.VariableDeclaration;
          path.node.right = generateAst.declarations[0].init;
          addInfoComment(path.node);
        }
      }
    }
  }
}

export default function (babel: { types: typeof BabelTypes }): {
  visitor: Visitor<IVisitorPass>
} {
  const { types: t } = babel;
  const cache = {
    pluginNameAssignmentExists: false,
    metaAssignmentExists: false,
  };
  return {
    visitor: {
      ExportDefaultDeclaration(path, state) {
        // 如果不是入口文件，则不做任何处理
        if (state.opts.filename !== state.filename) return;
        if (t.isIdentifier(path.node.declaration)) {
          const declarationName = path.node.declaration.name;
          path.parentPath.traverse(injectMetaVisitor, { ...state.opts, declarationName, cache })
          if (!cache.pluginNameAssignmentExists && state.opts?.meta?.pluginName) {
            const generatedNode  = template(`${declarationName}.pluginName = "${state.opts?.meta?.pluginName}"`)();
            addInfoComment(generatedNode);
            path.insertBefore(generatedNode);
          }
          if (!cache.metaAssignmentExists && state.opts?.meta?.meta) {
            const generatedNode = template(`${declarationName}.meta = ${JSON.stringify(state.opts?.meta?.meta)}`)();
            addInfoComment(generatedNode);
            path.insertBefore(generatedNode);
          }
        }
      },

    }
  };
}
