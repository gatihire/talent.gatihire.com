export type UUID = string

export type Job = {
  id: UUID
  title: string
  description: string | null
  location: string | null
  status: string | null
  created_at: string | null
  updated_at: string | null
  industry: string | null
  sub_category?: string | null
  client_name: string | null
  client_id?: UUID | null
  company_logo_url?: string | null
  city?: string | null
  salary_type?: string | null
  salary_min?: number | null
  salary_max?: number | null
  shift_type?: string | null
  employment_type?: string | null
  urgency_tag?: string | null
  openings?: number | null
  education_min?: string | null
  experience_min_years?: number | null
  experience_max_years?: number | null
  languages_required?: string[] | null
  english_level?: string | null
  license_type?: string | null
  age_min?: number | null
  age_max?: number | null
  gender_preference?: string | null
  role_category?: string | null
  department_category?: string | null
  skills_must_have?: string[] | null
  skills_good_to_have?: string[] | null
  apply_type?: "in_platform" | "external" | string | null
  external_apply_url?: string | null
}

export type JobSection = {
  id?: UUID
  job_id: UUID
  section_key: string
  heading: string
  body_md: string
  sort_order: number
  is_visible: boolean
}

export type ClientProfile = {
  id: UUID
  slug: string
  name: string
  about: string | null
  website: string | null
  company_type: string | null
  location: string | null
  logo_url: string | null
  created_at: string | null
  updated_at: string | null
}

export type Candidate = {
  id: UUID
  name: string
  email: string
  phone: string | null
  current_role: string
  current_company?: string | null
  location: string
  total_experience: string
  desired_role: string | null
  preferred_location: string | null
  looking_for_work?: boolean | null
  open_job_types?: string[] | null
  available_start_time?: string | null
  available_end_time?: string | null
  work_timezone?: string | null
  available_start_date?: string | null
  availability_notes?: string | null
  current_salary?: string | null
  expected_salary?: string | null
  notice_period?: string | null
  highest_qualification?: string | null
  degree?: string | null
  specialization?: string | null
  university?: string | null
  education_year?: string | null
  education_percentage?: string | null
  additional_qualifications?: string | null
  summary: string | null
  linkedin_profile: string | null
  portfolio_url: string | null
  github_profile: string | null
  technical_skills?: string[] | null
  soft_skills?: string[] | null
  languages_known?: string[] | null
  certifications?: unknown
  projects?: unknown
  public_profile_enabled?: boolean | null
  public_profile_slug?: string | null
  preferred_roles?: string[] | null
  file_name: string | null
  file_url: string | null
  file_size: number | null
  file_type: string | null
  tags: unknown
  updated_at: string | null
  uploaded_at: string | null
}

export type Application = {
  id: UUID
  job_id: UUID
  candidate_id: UUID
  status: string | null
  notes: string | null
  applied_at: string | null
  updated_at: string | null
  source: string | null
  match_score: number | null
}

export type ParsingJob = {
  id: UUID
  candidate_id: UUID | null
  file_id: UUID | null
  status: "pending" | "processing" | "completed" | "failed" | null
  parsing_method: string
  error_message: string | null
  created_at: string | null
  completed_at: string | null
}

export type ParsedWorkExperience = {
  company?: string
  role?: string
  duration?: string
  description?: string
  achievements?: string
  location?: string
  responsibilities?: string[]
  technologies?: string[]
}

export type ParsedEducation = {
  degree?: string
  specialization?: string
  institution?: string
  university?: string
  year?: string
  startYear?: string
  endYear?: string
  percentage?: string
  location?: string
  description?: string
}

export type ComprehensiveCandidateData = {
  [key: string]: unknown
  name?: string
  email?: string
  phone?: string
  currentRole?: string
  currentCompany?: string
  location?: string
  totalExperience?: string
  highestQualification?: string
  degree?: string
  specialization?: string
  university?: string
  educationYear?: string
  educationPercentage?: string
  additionalQualifications?: string
  technicalSkills?: string[]
  softSkills?: string[]
  languagesKnown?: string[]
  certifications?: string[]
  previousCompanies?: string[]
  jobTitles?: string[]
  workDuration?: string[]
  keyAchievements?: string[]
  projects?: string[]
  summary?: string
  resumeText?: string
  fileName?: string
  filePath?: string
  fileUrl?: string
  workExperience?: ParsedWorkExperience[]
  education?: ParsedEducation[]
}
