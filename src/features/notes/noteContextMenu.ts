import { t, type TFunction } from "i18next";

export type NoteContextMenuAction = "reveal" | "export" | "localize" | "move" | "delete";

export interface NoteContextMenuItem {
  action: NoteContextMenuAction;
  label: string;
  tone?: "danger";
}

export function getNoteContextMenuItems(translate: TFunction = t): NoteContextMenuItem[] {
  return [
    {
      action: "localize",
      label: translate("noteMenu.localizeImages", { defaultValue: "网络图片转为本地" }),
    },
    {
      action: "reveal",
      label: translate("noteMenu.reveal", { defaultValue: "在资源管理器中显示" }),
    },
    {
      action: "export",
      label: translate("noteMenu.export", { defaultValue: "导出 Markdown" }),
    },
    {
      action: "move",
      label: translate("noteMenu.moveToCategory", { defaultValue: "移动到分类…" }),
    },
    {
      action: "delete",
      label: translate("noteMenu.delete", { defaultValue: "删除笔记" }),
      tone: "danger",
    },
  ];
}
