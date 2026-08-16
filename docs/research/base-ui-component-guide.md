# Base UI component guide

## Scope and current version

This guide inventories every top-level component and utility listed in Base UI's official [`llms.txt`](https://base-ui.com/llms.txt) documentation index as reviewed on 2026-08-14. The index documents the `@base-ui/react` package, describes it as composable and styling-agnostic, and linked to the 1.7.0 documentation at the time of review. It contains 37 UI components and four utilities.

The “official purpose” text below is quoted or closely paraphrased from each component's first-party documentation. “Selection guidance” synthesizes the official descriptions and usage guidelines to make neighboring components easier to distinguish.

## Component inventory

| Component | Official purpose | Selection guidance |
|---|---|---|
| [Accordion](https://base-ui.com/react/components/accordion) | “A set of collapsible panels with headings.” | Use for a related set of headed disclosure sections; use Collapsible for one standalone panel. Supports one or multiple open panels. |
| [Alert Dialog](https://base-ui.com/react/components/alert-dialog) | “A dialog that requires a user response to proceed.” | Use for consequential confirmations or blocking decisions. Use ordinary Dialog when dismissal or an explicit response is not mandatory. |
| [Autocomplete](https://base-ui.com/react/components/autocomplete) | “An input that suggests options as you type.” | Use when free-form text remains valid and suggestions only optionally complete it. Use Combobox when the selected value must come from the provided items. It can also power filterable command pickers. |
| [Avatar](https://base-ui.com/react/components/avatar) | “An easily stylable avatar component.” | Use for a person or entity image with a fallback, such as initials, while an image is absent or loading fails. |
| [Button](https://base-ui.com/react/components/button) | “A button component that can be rendered as another tag or focusable when disabled.” | Use for actions, not navigation: it deliberately enforces button semantics. Explicitly set `type="submit"` for form submission. |
| [Checkbox](https://base-ui.com/react/components/checkbox) | “An easily stylable checkbox component.” | Use for an independently selectable boolean or one item in a multi-select set. Every checkbox needs an accessible name. |
| [Checkbox Group](https://base-ui.com/react/components/checkbox-group) | “Provides shared state to a series of checkboxes.” | Use when several checkbox choices form one multi-value field, including parent and indeterminate checkbox patterns. Use Radio for exactly one choice. |
| [Collapsible](https://base-ui.com/react/components/collapsible) | “A collapsible panel controlled by a button.” | Use for one disclosure panel. Use Accordion when several related, headed panels belong together. |
| [Combobox](https://base-ui.com/react/components/combobox) | “An input combined with a list of predefined items to select.” | Base UI calls it a filterable Select. Use for a large predefined list, single or multiple selection, async filtering, or creatable variants. Use Select when no input or filtering is rendered; use Autocomplete for free-form search or text. |
| [Context Menu](https://base-ui.com/react/components/context-menu) | “A menu that appears at the pointer on right click or long press.” | Use as a secondary shortcut for contextual actions. The docs explicitly require a visible, primary way to perform the same actions. |
| [Dialog](https://base-ui.com/react/components/dialog) | “A popup that opens on top of the entire page.” | Use for a focused task or important content without navigation. Use Popover or Menu for a small anchored hint or quick actions, Alert Dialog for a required response, and Drawer only when gesture or snap behavior is needed. |
| [Drawer](https://base-ui.com/react/components/drawer) | “A panel that slides in from the edge of the screen.” | Drawer extends Dialog with gestures, snap points, swipe areas, and indent effects. The docs say to use a positioned Dialog if those features are unnecessary. |
| [Field](https://base-ui.com/react/components/field) | “A component that provides labeling and validation for form controls.” | Use around one logical form control when it needs a label, description, validity state, or error messages. |
| [Fieldset](https://base-ui.com/react/components/fieldset) | “A native fieldset element with an easily stylable legend.” | Use to semantically group related controls under one legend, especially radio or checkbox sets. |
| [Form](https://base-ui.com/react/components/form) | “A native form element with consolidated error handling.” | Use at the form boundary to coordinate server or client validation errors and submission; compose Field and Fieldset inside it. |
| [Input](https://base-ui.com/react/components/input) | “A native input element that automatically works with Field.” | Use for ordinary text-like native input behavior. Choose Number Field or OTP Field when those specialized interaction models are required. |
| [Menu](https://base-ui.com/react/components/menu) | “A list of actions in a dropdown, enhanced with keyboard navigation.” | Use for commands or actions, optionally nested, checked, or radio-style. Use Navigation Menu for website links and Context Menu for right-click or long-press access. |
| [Menubar](https://base-ui.com/react/components/menubar) | “A menu bar providing commands and options for your application.” | Use for a persistent application-style command bar composed from multiple Menu roots, such as File and Edit menus. |
| [Meter](https://base-ui.com/react/components/meter) | “A graphical display of a numeric value within a range.” | Use for a measurement such as storage, score, or capacity. Use Progress when the value represents completion of an ongoing task. |
| [Navigation Menu](https://base-ui.com/react/components/navigation-menu) | “A collection of links and menus for website navigation.” | Use for site or page navigation, including nested and large link menus. Use Menu or Menubar for application commands. |
| [Number Field](https://base-ui.com/react/components/number-field) | “A numeric input element with increment and decrement buttons, and a scrub area.” | Use when exact numeric entry is needed, optionally with step buttons or scrubbing. Use Slider for direct graphical range adjustment. |
| [OTP Field](https://base-ui.com/react/components/otp-field) | “A one-time password input composed of individual character slots.” | Use for fixed-length verification, recovery, backup, or invitation codes. Supports numeric or alphanumeric validation, grouped layouts, masking, and completion submission. |
| [Popover](https://base-ui.com/react/components/popover) | “An accessible popup anchored to a button.” | Use when the trigger's purpose is to open accessible, potentially interactive content. For a nonessential visual label on an otherwise meaningful control, use Tooltip. |
| [Preview Card](https://base-ui.com/react/components/preview-card) | “A popup that appears when a link is hovered, showing a preview for sighted users.” | Use only as a visual enhancement to a link. The popup must not contain unique or essential information because it is unavailable to touch and screen-reader users. |
| [Progress](https://base-ui.com/react/components/progress) | “Displays the status of a task that takes a long time.” | Use for determinate or indeterminate task completion. Use Meter for a static numeric measurement unrelated to task completion. |
| [Radio](https://base-ui.com/react/components/radio) | “An easily stylable radio button component.” | Use inside Radio Group when exactly one option must be chosen from a visible set. Use Checkbox Group for multiple independent choices. |
| [Scroll Area](https://base-ui.com/react/components/scroll-area) | “A native scroll container with custom scrollbars.” | Use when native scrolling semantics and behavior should be retained while custom scrollbar UI, both axes, corners, or scroll fades are needed. |
| [Select](https://base-ui.com/react/components/select) | “A common form component for choosing a predefined value in a dropdown menu.” | Use for a predefined, non-filterable list with keyboard typeahead. The docs recommend Combobox when the list is large enough to warrant filtering. |
| [Separator](https://base-ui.com/react/components/separator) | “A separator element accessible to screen readers.” | Use for a semantic visual division between content or control groups, with horizontal or vertical orientation. |
| [Slider](https://base-ui.com/react/components/slider) | “An easily stylable range input.” | Use for direct manipulation of one value or a minimum and maximum range. Use Number Field when precise typed entry and increment or decrement controls matter more. |
| [Switch](https://base-ui.com/react/components/switch) | “A control that indicates whether a setting is on or off.” | Use for an on or off setting. Use Checkbox for selection or acknowledgment and Toggle for the pressed state of a button-like command. |
| [Tabs](https://base-ui.com/react/components/tabs) | “A component for toggling between related panels on the same page.” | Use for peer views or panels that share one page context. Use Navigation Menu when choices navigate to separate destinations. |
| [Toast](https://base-ui.com/react/components/toast) | “Generates toast notifications.” | Use for transient, nonblocking feedback, async or promise status, undo actions, or feedback anchored to an element. It supports keyboard access, screen-reader announcements, stacking, and swipe dismissal. |
| [Toggle](https://base-ui.com/react/components/toggle) | “A two-state button that can be on or off.” | Use for a pressed or unpressed command state such as bold, alignment, or favorite. Use Switch for a persistent setting and Checkbox for form selection. |
| [Toggle Group](https://base-ui.com/react/components/toggle-group) | “Provides a shared state to a series of toggle buttons.” | Use for a coordinated single- or multiple-selection set of Toggle buttons, such as text alignment or formatting controls. |
| [Toolbar](https://base-ui.com/react/components/toolbar) | “A container for grouping a set of buttons and controls.” | Use for a keyboard-navigable action or control strip. In horizontal toolbars, the docs recommend at most one input and placing it last because arrow keys are shared with toolbar navigation. |
| [Tooltip](https://base-ui.com/react/components/tooltip) | “A popup that appears when an element is hovered or focused, showing a hint for sighted users.” | Use only for supplementary, nonessential visual labels in dense UIs. Tooltips are disabled on touch and do not replace an accessible name. Use Popover for infotips or content whose trigger exists to open the popup; use inline text for essential explanations. |

## Utility inventory

| Utility | Official purpose | Use when |
|---|---|---|
| [CSP Provider](https://base-ui.com/react/utils/csp-provider) | “Configures CSP-related behavior for inline tags rendered by Base UI components.” | A strict Content Security Policy requires nonces on Base UI's inline style or script tags, or inline style elements must be disabled. |
| [Direction Provider](https://base-ui.com/react/utils/direction-provider) | “Enables RTL behavior for Base UI components.” | Components need behavior, not merely CSS, to follow right-to-left direction. |
| [mergeProps](https://base-ui.com/react/utils/merge-props) | “A utility to merge multiple sets of React props.” | Combining internal and consumer props while correctly composing class names, styles, and handlers. Rightmost ordinary values win; handlers execute right-to-left. |
| [useRender](https://base-ui.com/react/utils/use-render) | “Hook for enabling a render prop in custom components.” | Building custom polymorphic components with Base UI-style element replacement and composition. |

## Highest-value decision rules

- **Autocomplete vs. Combobox vs. Select:** Free-form value → Autocomplete; constrained and filterable predefined value → Combobox; constrained and non-filterable dropdown → Select. See the official [Autocomplete usage guidelines](https://base-ui.com/react/components/autocomplete#usage-guidelines), [Combobox usage guidelines](https://base-ui.com/react/components/combobox#usage-guidelines), and [Select usage guidelines](https://base-ui.com/react/components/select#usage-guidelines).
- **Dialog family:** Focused interruptive task → Dialog; mandatory explicit response → Alert Dialog; gesture- or snap-enabled edge panel → Drawer; small anchored content → Popover. The [Drawer usage guidelines](https://base-ui.com/react/components/drawer#usage-guidelines) explicitly describe Drawer as Dialog plus gesture support, snap points, and indent effects.
- **Tooltip vs. Popover vs. Preview Card:** Supplementary hint attached to a control → Tooltip; accessible popup whose trigger exists to open it → Popover; nonessential visual preview of a link destination → Preview Card. See [Tooltip alternatives](https://base-ui.com/react/components/tooltip#alternatives-to-tooltips) and [Preview Card usage guidelines](https://base-ui.com/react/components/preview-card#usage-guidelines).
- **Menu family:** Trigger-opened actions → Menu; secondary right-click actions → Context Menu; persistent application command bar → Menubar; destination links → Navigation Menu. A [Context Menu example](https://base-ui.com/react/components/context-menu#using-with-menu) explicitly says a context menu should supplement a primary way to perform the same actions.
- **Disclosure:** One panel → Collapsible; a headed collection → Accordion; peer content views → Tabs.
- **Binary and choice controls:** Setting on or off → Switch; independent or multi-select form choice → Checkbox; exactly one choice → Radio; pressed-state command → Toggle.
- **Numeric and status:** Exact numeric entry → Number Field; direct graphical adjustment → Slider; static measurement → Meter; task completion → Progress.
- **Form structure:** One control's labeling and validation → Field; related-control grouping → Fieldset; whole-form submission and error coordination → Form.

## Sources

- [Base UI `llms.txt` documentation index](https://base-ui.com/llms.txt)
- [Base UI React documentation](https://base-ui.com/react/overview/quick-start)
- Individual official component and utility pages linked in the inventories above
