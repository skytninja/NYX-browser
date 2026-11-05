// NYX launcher: the bundle's main executable.
//
// Firefox picks its data folder from values compiled into the binary, so without
// this it would share ~/Library/Application Support/Firefox with a regular Firefox.
// We always pass our own profile, then replace this process with the real browser.
// exec keeps the PID, so macOS still sees one app and delivers links to it.
#include <errno.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <pwd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#define STAMP_SIZE 64

static int mkdir_p(char *path) {
    for (char *p = path + 1; *p; p++) {
        if (*p != '/') continue;
        *p = '\0';
        int failed = mkdir(path, 0700) != 0 && errno != EEXIST;
        *p = '/';
        if (failed) return -1;
    }
    return (mkdir(path, 0700) != 0 && errno != EEXIST) ? -1 : 0;
}

static size_t read_stamp(const char *path, char *out, size_t size) {
    FILE *file = fopen(path, "r");
    if (!file) return 0;
    size_t length = fread(out, 1, size - 1, file);
    fclose(file);
    out[length] = '\0';
    return length;
}

// Our builds keep Firefox's build ID, so Firefox can't tell the app changed and would keep
// showing the old interface from its cache. Returns 1 when this profile last ran another build.
static int build_changed(const char *app_macos_dir, const char *profile) {
    char app_stamp_path[PATH_MAX], profile_stamp_path[PATH_MAX];
    char app_stamp[STAMP_SIZE], profile_stamp[STAMP_SIZE];
    if (snprintf(app_stamp_path, sizeof(app_stamp_path), "%s/../Resources/nyx-build-stamp", app_macos_dir)
        >= (int)sizeof(app_stamp_path)) return 0;
    if (snprintf(profile_stamp_path, sizeof(profile_stamp_path), "%s/nyx-build-stamp", profile)
        >= (int)sizeof(profile_stamp_path)) return 0;
    if (!read_stamp(app_stamp_path, app_stamp, sizeof(app_stamp))) return 0;
    if (read_stamp(profile_stamp_path, profile_stamp, sizeof(profile_stamp))
        && strcmp(app_stamp, profile_stamp) == 0) return 0;

    FILE *file = fopen(profile_stamp_path, "w");
    if (file) {
        fputs(app_stamp, file);
        fclose(file);
    }
    return 1;
}

int main(int argc, char **argv) {
    char raw[PATH_MAX], self[PATH_MAX], browser[PATH_MAX], profile[PATH_MAX];
    uint32_t size = sizeof(raw);
    if (_NSGetExecutablePath(raw, &size) != 0 || !realpath(raw, self)) {
        fprintf(stderr, "nyx: cannot find own path\n");
        return 1;
    }
    char *slash = strrchr(self, '/');
    if (!slash) return 1;
    *slash = '\0';
    if (snprintf(browser, sizeof(browser), "%s/firefox", self) >= (int)sizeof(browser)) return 1;

    struct passwd *pw = getpwuid(getuid());
    const char *home = pw ? pw->pw_dir : getenv("HOME");
    if (!home) {
        fprintf(stderr, "nyx: no home directory\n");
        return 1;
    }
    const char *profile_override = getenv("NYX_PROFILE_DIR");
    int written = profile_override
        ? snprintf(profile, sizeof(profile), "%s", profile_override)
        : snprintf(profile, sizeof(profile), "%s/Library/Application Support/NYX/Profiles/default", home);
    if (written >= (int)sizeof(profile)) return 1;
    if (mkdir_p(profile) != 0) {
        perror("nyx: cannot create profile");
        return 1;
    }

    char **args = calloc((size_t)argc + 4, sizeof(char *));
    if (!args) return 1;
    int n = 0;
    args[n++] = browser;
    args[n++] = "--profile";
    args[n++] = profile;
    if (build_changed(self, profile)) args[n++] = "-purgecaches";
    for (int i = 1; i < argc; i++) {
        if (strncmp(argv[i], "-psn_", 5) != 0) args[n++] = argv[i];
    }
    execv(browser, args);
    perror("nyx: cannot start browser");
    return 1;
}
