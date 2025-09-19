// Type declarations for untyped modules
declare module 'epub-check' {
  export default function epubCheck(filePath: string): Promise<{
    pass: boolean;
    messages: Array<{ message?: string; [key: string]: unknown }>;
  }>;
}
