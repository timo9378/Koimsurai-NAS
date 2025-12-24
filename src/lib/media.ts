export const getStreamUrl = (path: string): string => {
  // Ensure the path is properly encoded for the URL parameter
  const encodedPath = encodeURIComponent(path);
  return `/api/media/stream?path=${encodedPath}`;
};

export const getTimelineUrl = (path: string): string => {
  const encodedPath = encodeURIComponent(path);
  return `/api/media/timeline?path=${encodedPath}`;
};