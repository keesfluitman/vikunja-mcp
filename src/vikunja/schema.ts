import { z } from 'zod';

// Vikunja returns "0001-01-01T00:00:00Z" for unset dates — treat as absent
const VIKUNJA_NULL_DATE = '0001-01-01T00:00:00Z';
export const DateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .optional()
  .transform(val => (val === VIKUNJA_NULL_DATE ? undefined : val));

// Vikunja's API is inconsistent about hex colors: project create/update
// expects "#RRGGBB", but labels are stored without the leading "#" (e.g.
// "dc2626"). Accept either form so the LLM doesn't have to memorize which is
// which.
export const HexColorSchema = z
  .string()
  .regex(/^#?[0-9A-Fa-f]{6}$/, 'Must be a 6-digit hex color, "#" optional')
  .optional();
export const IdentifierSchema = z.string().min(0).max(10);
export const RightsSchema = z.number().int().min(0).max(2); // 0: RO, 1: RW, 2: Admin
export const RelationKindSchema = z.enum([
  'unknown',
  'subtask',
  'parenttask',
  'related',
  'duplicateof',
  'duplicates',
  'blocking',
  'blocked',
  'precedes',
  'follows',
  'copiedfrom',
  'copiedto',
]);

export const UserSchema = z.object({
  created: DateTimeSchema,
  email: z.string().optional(),
  id: z.number(),
  name: z.string().optional(),
  updated: DateTimeSchema,
  username: z.string(),
});

export const LabelSchema = z.object({
  description: z.string().optional(),
  hex_color: HexColorSchema,
  id: z.number(),
  title: z.string(),
});

// Common types that can be reused
export type HexColor = z.infer<typeof HexColorSchema>;
export type Identifier = z.infer<typeof IdentifierSchema>;
export type DateTime = z.infer<typeof DateTimeSchema>;
export type Rights = z.infer<typeof RightsSchema>;
export type RelationKind = z.infer<typeof RelationKindSchema>;
export type User = z.infer<typeof UserSchema>;
export type Label = z.infer<typeof LabelSchema> & {
  created: DateTime;
  created_by: User;
  updated: DateTime;
};

// Common validation messages
export const ValidationMessages = {
  hexColor: 'Must be a valid hex color code (e.g. #FF0000)',
  identifier: 'Must be between 0 and 10 characters',
  dateTime: 'Must be a valid ISO datetime string',
  rights: 'Must be a number between 0 and 2 (0: RO, 1: RW, 2: Admin)',
} as const;
