/** Iconify classes used by Inkfinite's shared icon component. */
export const ICONS = {
  add: "i-ph-plus-bold",
  arrow: "i-tabler-arrow-up-right",
  check: "i-bi-check-lg",
  close: "i-ph-x-bold",
  dark: "i-tabler-moon",
  delete: "i-bi-trash3",
  draw: "i-ph-pencil-simple-line-bold",
  light: "i-tabler-sun",
  menu: "i-bi-list",
  redo: "i-tabler-arrow-forward-up",
  save: "i-ph-floppy-disk-back-bold",
  settings: "i-bi-sliders",
  undo: "i-tabler-arrow-back-up",
} as const;

/** A semantic icon name supported by the shared icon component. */
export type IconName = keyof typeof ICONS;
