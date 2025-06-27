/**
 * Shared JSON schema types for all structured prompt functions.
 */

export interface PromptShape<T extends JSONSchemaObject> {
  systemPrompt: string;
  userPrompt: string;
  options: OptionsShape<T>;
}

export interface OptionsShape<T extends JSONSchemaObject> {
  schema_name: string;
  schema: T;
}

export interface JSONSchemaObject {
  type: "object";
  required?: string[];
  properties: Record<string, JSONSchemaProperty>;
  additionalProperties?: boolean;
}

export type JSONSchemaType =
  | "string"
  | "integer"
  | "array"
  | "object"
  | "boolean"
  | ["string", "null"]
  | ["object", "null"];

export interface JSONSchemaProperty {
  type: JSONSchemaType;
  minimum?: number;
  properties?: Record<string, JSONSchemaProperty>;
  items?: JSONSchemaProperty;
  required?: string[];
  additionalProperties?: boolean;
}

export interface NewsExtractionResponse extends JSONSchemaObject {
  properties: {
    articles: {
      type: "array";
      items: {
        type: "object";
        required: ["title", "link"];
        properties: {
          title: { type: "string" };
          link: { type: "string" };
          description: { type: ["string", "null"] };
          image: {
            type: ["object", "null"];
            properties: {
              url: { type: "string" };
              caption: { type: "string" };
            };
            additionalProperties: false;
          };
        };
        additionalProperties: false;
      };
    };
  };
}

export interface ArticleCountResponse extends JSONSchemaObject {
  properties: {
    article_count: {
      type: "integer";
      minimum: 0;
    };
  };
}

export interface SingleQuestionResponse extends JSONSchemaObject {
  properties: {
    question: {
      type: "string";
    };
  };
}

export interface QuestionsResponse extends JSONSchemaObject {
  properties: {
    questions: {
      type: "array";
      items: {
        type: "object";
        required: ["question"];
        properties: {
          question: {
            type: "string";
          };
        };
      };
    };
  };
}

export interface AnswerResponse extends JSONSchemaObject {
  properties: {
    answer: {
      type: "string";
    };
  };
}

export interface SnippetResponse extends JSONSchemaObject {
  properties: {
    snippet: {
      type: "string";
    };
  };
}

export interface DirectiveResponse extends JSONSchemaObject {
  properties: {
    directives: {
      type: "array";
      items: {
        type: "string";
      };
    };
  };
}

export interface TransformationDirectiveResponse extends JSONSchemaObject {
  properties: {
    directive: {
      type: "string";
    };
  };
}
