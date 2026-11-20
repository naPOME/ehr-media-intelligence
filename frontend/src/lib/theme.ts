import type { ThemeConfig } from "antd";
export const clinicalTheme: ThemeConfig = {
  cssVar: { key: "clinical" },
  token: {
    colorPrimary: "#3269c4",
    colorInfo: "#3269c4",
    colorSuccess: "#2b6b49",
    colorWarning: "#8a5815",
    colorError: "#b3383b",
    colorText: "#253445",
    colorTextSecondary: "#536578",
    colorBgLayout: "#f3f5f7",
    colorBorder: "#c8d2dd",
    colorBorderSecondary: "#dce2e8",
    borderRadius: 9,
    controlHeight: 38,
    controlHeightLG: 40,
    fontFamily:
      '"Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: 14,
    fontSizeHeading1: 24,
    fontWeightStrong: 600,
    boxShadowSecondary: "0 8px 32px rgba(25, 45, 65, 0.12)",
  },
  components: {
    Button: { primaryShadow: "none", fontWeight: 500 },
    Tabs: { horizontalItemGutter: 24 },
    Breadcrumb: { itemColor: "#536578", separatorColor: "#63758a" },
    Menu: {
      itemHeight: 46,
      itemBorderRadius: 7,
      itemSelectedBg: "#eaf2fb",
      itemSelectedColor: "#3269c4",
      itemMarginInline: 12,
    },
    Table: {
      headerBg: "#f8fafc",
      headerColor: "#526477",
      rowHoverBg: "#f6f9fd",
      cellPaddingBlockMD: 15,
    },
  },
};
