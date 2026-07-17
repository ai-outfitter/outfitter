 ask_user_question is not vanilla Pi. In this session it comes from the Pi package:

 - npm:@juicesharp/rpiv-ask-user-question
 - It registers the tool named ask_user_question.

 What changes if you exclude it:

 - The tool is not registered/active, so the model cannot call ask_user_question.
 - Its tool schema/long description is no longer sent as a model-visible tool definition.
 - Its promptSnippet disappears from Pi’s “Available tools” part of the system prompt.
 - Its promptGuidelines disappear from Pi’s “Guidelines” section.
 - Nothing from that package should remain unless another profile/context file independently mentions it.

 The long text you see is real extension metadata, not vanilla Pi CLI help. In the package, it is the tool description plus prompt guidance. Pi exposes that to the model/tool layer; it is not pi --help output.

 Pi extension docs distinguish these pieces:

 - description: shown to the LLM as tool metadata.
 - promptSnippet: short one-line system-prompt entry.
 - promptGuidelines: extra system-prompt bullets, only while the tool is active.

 Vanilla Pi has the extension API needed to build this, but not the ask_user_question tool itself by default.