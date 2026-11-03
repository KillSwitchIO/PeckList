// Tabs on any docs page without an import line, so the pages stay plain Markdown to read.
import MDXComponents from '@theme-original/MDXComponents';
import TabItem from '@theme/TabItem';
import Tabs from '@theme/Tabs';

export default { ...MDXComponents, Tabs, TabItem };
