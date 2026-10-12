import { z } from "zod";

export const DESIGNATIONS = ["NON_EXECUTIVE", "EXECUTIVE", "MANAGER", "CONTRACT", "TRAINEE"] as const;

export const DESIGNATION_LABELS: Record<(typeof DESIGNATIONS)[number], string> = {
  NON_EXECUTIVE: "Non-executive",
  EXECUTIVE: "Executive",
  MANAGER: "Manager",
  CONTRACT: "Contract",
  TRAINEE: "Trainee",
};

export const GENDERS = ["MALE", "FEMALE"] as const;

export const GENDER_LABELS: Record<(typeof GENDERS)[number], string> = { MALE: "Male", FEMALE: "Female" };

/** Job grades, as on the staff pass: 1 to 5. Used for TNA by job grade. */
export const JOB_GRADES = [1, 2, 3, 4, 5] as const;

const optionalDate = z
  .union([z.literal(""), z.iso.date("Enter a date as DD/MM/YYYY")])
  .transform((v) => (v ? new Date(`${v}T00:00:00Z`) : null));

export const staffNoSchema = z
  .string()
  .trim()
  .min(3, "At least 3 characters")
  .max(20, "At most 20 characters")
  .regex(/^[A-Za-z0-9-]+$/, "Letters, digits and dashes only")
  .transform((s) => s.toUpperCase());

export const staffSchema = z.object({
  staffNo: staffNoSchema,
  name: z.string().trim().min(3, "Enter the full name").max(160),
  email: z
    .union([z.literal(""), z.email("Not a valid email address").max(160)])
    .transform((v) => (v ? v.toLowerCase() : null)),
  position: z
    .string()
    .trim()
    .max(120)
    .transform((v) => v || null),
  designation: z.enum(DESIGNATIONS, "Choose a designation"),
  /** Optional: older records have none. */
  gender: z.union([z.literal(""), z.enum(GENDERS, "Choose Male or Female")]).transform((v) => v || null),
  departmentId: z.coerce.number({ error: "Choose a department" }).int().positive("Choose a department"),
  sectionId: z
    .union([z.literal(""), z.coerce.number().int().positive()])
    .transform((v) => (v === "" ? null : v)),
  dateJoined: optionalDate,
  jobGrade: z
    .union([z.literal(""), z.coerce.number("Choose a grade from 1 to 5").int("Choose a grade from 1 to 5").min(1, "Choose a grade from 1 to 5").max(5, "Choose a grade from 1 to 5")])
    .transform((v) => (v === "" ? null : v)),
  /** A non-executive who fills in their own TNA. Only L&D can set it (the staff service keeps it otherwise). */
  fillsOwnTna: z.boolean().default(false),
});

export type StaffInput = z.infer<typeof staffSchema>;

export const resignSchema = z.object({
  dateResigned: z.iso.date("Enter the last working day").transform((v) => new Date(`${v}T00:00:00Z`)),
});

export const passwordResetSchema = z.object({
  password: z.string().min(8, "At least 8 characters").max(200),
});

export const changePasswordSchema = z
  .object({
    current: z.string().min(1, "Enter your current password"),
    next: z.string().min(8, "At least 8 characters").max(200),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, { path: ["confirm"], message: "Does not match the new password" });
