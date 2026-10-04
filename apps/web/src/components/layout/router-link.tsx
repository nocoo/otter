import type { LinkComponent } from "@nocoo/basalt/providers/link";
import type { ComponentProps } from "react";
import { Link } from "react-router";

export const RouterLink: LinkComponent = ({ href, ...props }) => {
  if (href.startsWith("/") && !href.startsWith("//")) return <Link to={href} {...props} />;
  return <a href={href} {...(props as ComponentProps<"a">)} />;
};
