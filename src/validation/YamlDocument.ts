// Parses YAML text into Outfitter validation-friendly document results.
import { parse } from 'yaml';

export interface ParsedYamlDocument {
  readonly ok: true;
  readonly document: unknown;
}

export interface YamlParseFailure {
  readonly ok: false;
  readonly issue: {
    readonly path: string;
    readonly message: string;
  };
}

export type YamlParseResult = ParsedYamlDocument | YamlParseFailure;

export const parseYamlDocument = (content: string, issuePath: string): YamlParseResult => {
  try {
    return { ok: true, document: parse(content) };
  } catch (error) {
    return { ok: false, issue: { path: issuePath, message: String(error) } };
  }
};
