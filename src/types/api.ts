// Generated from Rust models

// User Models
export interface User {
  id: number; // i64 in Rust, but JS number is safe up to 2^53
  username: string;
  created_at: string; // ISO 8601
}

export interface AuthResponse {
  token: string;
}
export interface LoginRequest {
  username: string;
  password: string;
  remember?: boolean;
}

export interface RegisterRequest {
  username: string;
  password: string;
  invite_code: string;
}

// File Models
export interface FileMetadata {
  // Assuming structure based on usage, as it was imported in Rust
  [key: string]: unknown;
}

export interface Tag {
  name: string;
  color: string | null;
}

export interface UserTag {
  name: string;
  color: string | null;
  count: number;
}

export interface TaggedFile {
  path: string;
  name: string;
  is_dir: boolean;
}

export interface FileInfo {
  name: string;
  path: string; // Added path for convenience
  is_dir: boolean;
  size: number; // u64 in Rust
  modified: string;
  mime_type: string | null;
  metadata: FileMetadata | null;
  tags: Tag[];
  is_starred: boolean;
}

export interface FileVersion {
  id: string;
  size: number;
  modified: string;
  path: string;
}

export interface BatchOperationRequest {
  paths: string[];
  destination?: string;
}

export interface TagRequest {
  name: string;
  color: string;
}

// Job Models
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface Job {
  id: string;
  job_type: string;
  status: string; // Using string as it comes from DB, but logically JobStatus
  progress: number;
  created_at: string;
  updated_at: string;
  error: string | null;
}

export interface JobUpdate {
  job_id: string;
  status: JobStatus;
  progress: number;
  error: string | null;
  type?: string;
}

// Upload Models
export interface InitUploadRequest {
  file_path: string;
  file_name: string;
  total_size: number;
}

export interface InitUploadResponse {
  upload_id: string;
  uploaded_size?: number;
}

export interface UploadSession {
  id: string;
  user_id: number;
  file_path: string;
  file_name: string;
  total_size: number;
  uploaded_size: number;
  created_at: string;
  updated_at: string;
}

// System/Docker Models (Inferred from prompt requirements as they weren't in the file list)
export interface DiskInfo {
  name: string;
  mount_point: string;
  total_space: number;
  available_space: number;
  disk_type: string;
}

export interface GpuInfo {
  name: string;
  memory_total: number;
  memory_used: number;
  memory_free: number;
  utilization: number;
  temperature: number;
}

export interface SystemStatus {
  cpu_usage: number;
  cpu_temp?: number;
  total_memory: number;
  used_memory: number;
  total_swap: number;
  used_swap: number;
  disks: DiskInfo[];
  gpu?: GpuInfo;
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: 'running' | 'stopped' | 'paused' | 'exited';
  cpu_usage: string;
  memory_usage: string;
}

export interface DockerStats {
  container_id: string;
  cpu_percentage: number;
  memory_usage: number;
  memory_limit: number;
}