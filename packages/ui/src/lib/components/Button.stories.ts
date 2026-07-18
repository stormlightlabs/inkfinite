import type { Meta, StoryObj } from "@storybook/sveltekit";

import Button from "./Button.svelte";

const meta = {
  title: "Controls/Button",
  component: Button,
  tags: ["autodocs"],
  args: { label: "Save drawing", icon: "save", variant: "secondary" },
  argTypes: {
    variant: {
      control: "select",
      options: ["primary", "secondary", "ghost", "danger"],
    },
    size: { control: "select", options: ["small", "medium"] },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Primary: Story = { args: { variant: "primary" } };
export const Destructive: Story = {
  args: { label: "Delete selection", icon: "delete", variant: "danger" },
};
export const Busy: Story = { args: { busy: true, label: "Saving…" } };
