// NYX launcher for Windows: nyx.exe, next to firefox.exe.
//
// Firefox keeps its data in %APPDATA%\Mozilla\Firefox, shared with a regular Firefox.
// We always pass our own profile, %APPDATA%\NYX\Profiles\default, then start the real browser.
// "--nyx-profile=<dir>" as the first argument picks another profile (spaces use it).
// The rest of the command line goes to Firefox unchanged.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shlobj.h>
#include <wchar.h>

#define STAMP_SIZE 64
#define PROFILE_FLAG L"--nyx-profile="

static size_t read_stamp(const wchar_t *path, char *out, size_t size) {
    HANDLE file = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
    if (file == INVALID_HANDLE_VALUE) return 0;
    DWORD length = 0;
    if (!ReadFile(file, out, (DWORD)size - 1, &length, NULL)) length = 0;
    CloseHandle(file);
    out[length] = '\0';
    return length;
}

// Our builds keep Firefox's build ID, so Firefox can't tell the app changed and would keep
// showing the old interface from its cache. Returns 1 when this profile last ran another build.
static int build_changed(const wchar_t *app_dir, const wchar_t *profile) {
    wchar_t app_stamp_path[MAX_PATH * 2], profile_stamp_path[MAX_PATH * 2];
    char app_stamp[STAMP_SIZE], profile_stamp[STAMP_SIZE];
    if (_snwprintf(app_stamp_path, MAX_PATH * 2, L"%ls\\nyx-build-stamp", app_dir) < 0) return 0;
    if (_snwprintf(profile_stamp_path, MAX_PATH * 2, L"%ls\\nyx-build-stamp", profile) < 0) return 0;
    if (!read_stamp(app_stamp_path, app_stamp, sizeof(app_stamp))) return 0;
    if (read_stamp(profile_stamp_path, profile_stamp, sizeof(profile_stamp)) && strcmp(app_stamp, profile_stamp) == 0) return 0;

    HANDLE file = CreateFileW(profile_stamp_path, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, 0, NULL);
    if (file != INVALID_HANDLE_VALUE) {
        DWORD written;
        WriteFile(file, app_stamp, (DWORD)strlen(app_stamp), &written, NULL);
        CloseHandle(file);
    }
    return 1;
}

// Skips one argument of a Windows command line (quotes and backslashes as CommandLineToArgvW reads them).
static const wchar_t *skip_argument(const wchar_t *p) {
    while (*p == L' ' || *p == L'\t') p++;
    int quoted = 0;
    while (*p && (quoted || (*p != L' ' && *p != L'\t'))) {
        if (*p == L'"') quoted = !quoted;
        p++;
    }
    while (*p == L' ' || *p == L'\t') p++;
    return p;
}

static void fail(const wchar_t *message) {
    MessageBoxW(NULL, message, L"NYX Browser", MB_ICONERROR | MB_OK);
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE previous, PWSTR raw_args, int show) {
    (void)instance; (void)previous; (void)raw_args; (void)show;
    wchar_t self[MAX_PATH * 2], browser[MAX_PATH * 2], profile[MAX_PATH * 2];
    DWORD length = GetModuleFileNameW(NULL, self, MAX_PATH * 2);
    if (length == 0 || length >= MAX_PATH * 2) return 1;
    wchar_t *slash = wcsrchr(self, L'\\');
    if (!slash) return 1;
    *slash = L'\0';
    if (_snwprintf(browser, MAX_PATH * 2, L"%ls\\firefox.exe", self) < 0) return 1;

    // Everything after nyx.exe itself.
    const wchar_t *rest = skip_argument(GetCommandLineW());

    profile[0] = L'\0';
    if (wcsncmp(rest, PROFILE_FLAG, wcslen(PROFILE_FLAG)) == 0 || wcsncmp(rest, L"\"" PROFILE_FLAG, wcslen(PROFILE_FLAG) + 1) == 0) {
        // The value may be quoted as a whole ("--nyx-profile=C:\a b") by the caller.
        int quoted = rest[0] == L'"';
        const wchar_t *value = rest + wcslen(PROFILE_FLAG) + quoted;
        const wchar_t *end = skip_argument(rest);
        size_t n = 0;
        for (const wchar_t *p = value; p < end && n < MAX_PATH * 2 - 1; p++) {
            if (*p != L'"') profile[n++] = *p;
        }
        while (n && (profile[n - 1] == L' ' || profile[n - 1] == L'\t')) n--;
        profile[n] = L'\0';
        rest = end;
    } else {
        PWSTR appdata = NULL;
        if (FAILED(SHGetKnownFolderPath(&FOLDERID_RoamingAppData, 0, NULL, &appdata))) {
            fail(L"Не найдена папка AppData.");
            return 1;
        }
        int written = _snwprintf(profile, MAX_PATH * 2, L"%ls\\NYX\\Profiles\\default", appdata);
        CoTaskMemFree(appdata);
        if (written < 0) return 1;
    }
    int made = SHCreateDirectoryExW(NULL, profile, NULL);
    if (made != ERROR_SUCCESS && made != ERROR_ALREADY_EXISTS && made != ERROR_FILE_EXISTS) {
        fail(L"Не получилось создать папку профиля.");
        return 1;
    }

    // firefox.exe --profile "<dir>" [-purgecaches] <the rest, unchanged>
    size_t size = wcslen(browser) + wcslen(profile) + wcslen(rest) + 64;
    wchar_t *command = HeapAlloc(GetProcessHeap(), 0, size * sizeof(wchar_t));
    if (!command) return 1;
    _snwprintf(command, size, L"\"%ls\" --profile \"%ls\"%ls %ls", browser, profile,
               build_changed(self, profile) ? L" -purgecaches" : L"", rest);
    command[size - 1] = L'\0';

    STARTUPINFOW startup;
    ZeroMemory(&startup, sizeof(startup));
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION process;
    if (!CreateProcessW(browser, command, NULL, NULL, FALSE, 0, NULL, self, &startup, &process)) {
        fail(L"Не получилось запустить браузер.");
        return 1;
    }
    // Lets the browser take the foreground: it was started by the app the user just opened.
    AllowSetForegroundWindow(process.dwProcessId);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    return 0;
}
