// i2pd as a library: start(opts) / stop() / status(). No daemon, no GUI code.
#include <node_api.h>
#include <string>
#include <vector>
#include "api.h"
#include "ClientContext.h"
#include "RouterContext.h"
#include "NetDb.hpp"
#include "Tunnel.h"
#include "Transports.h"

#ifdef _WIN32
// The import lib names node.exe; bind to whatever exe hosts us (bare.exe, electron.exe), as node-gyp does.
#include <windows.h>
#include <delayimp.h>
static FARPROC WINAPI loadHook (unsigned event, PDelayLoadInfo info) {
  if (event == dliNotePreLoadLibrary && _stricmp(info->szDll, "node.exe") == 0) return (FARPROC)GetModuleHandle(nullptr);
  return nullptr;
}
extern "C" const PfnDliHook __pfnDliNotifyHook2 = loadHook;
#endif

static bool inited = false;
static bool running = false;

static napi_value prop (napi_env env, napi_value obj, const char* name) {
  bool has = false;
  napi_has_named_property(env, obj, name, &has);
  if (!has) return nullptr;
  napi_value v; napi_get_named_property(env, obj, name, &v);
  napi_valuetype t; napi_typeof(env, v, &t);
  return t == napi_undefined || t == napi_null ? nullptr : v;
}

static std::string str (napi_env env, napi_value v) {
  size_t n = 0;
  napi_get_value_string_utf8(env, v, nullptr, 0, &n);
  std::string s(n, '\0');
  napi_get_value_string_utf8(env, v, &s[0], n + 1, &n);
  return s;
}

static int num (napi_env env, napi_value v) { int n = 0; napi_get_value_int32(env, v, &n); return n; }
static bool flag (napi_env env, napi_value v) { bool b = false; napi_get_value_bool(env, v, &b); return b; }

// start({ dataDir, samPort, bandwidth?, share?, notransit?, ipv6? })
static napi_value start (napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  napi_value dir = argc ? prop(env, argv[0], "dataDir") : nullptr;
  napi_value port = argc ? prop(env, argv[0], "samPort") : nullptr;
  if (running || !dir || !port) { napi_throw_error(env, nullptr, "start({ dataDir, samPort }): already running or bad options"); return nullptr; }
  if (!inited) {
    // Options are read once per process: i2pd's config can't be initialised twice.
    std::string d = str(env, dir);
    static std::vector<std::string> a;
    a = {"i2pd", "--datadir=" + d, "--log=file", "--logfile=" + d + "/i2pd.log", "--loglevel=warn",
         "--sam.enabled=true", "--sam.address=127.0.0.1", "--sam.port=" + std::to_string(num(env, port)),
         "--http.enabled=false", "--httpproxy.enabled=false", "--socksproxy.enabled=false",
         "--i2pcontrol.enabled=false", "--bob.enabled=false", "--i2cp.enabled=false", "--upnp.enabled=false"};
    napi_value v;
    if ((v = prop(env, argv[0], "bandwidth"))) a.push_back("--bandwidth=" + str(env, v));
    if ((v = prop(env, argv[0], "share"))) a.push_back("--share=" + std::to_string(num(env, v)));
    if ((v = prop(env, argv[0], "notransit")) && flag(env, v)) a.push_back("--notransit");
    if ((v = prop(env, argv[0], "ipv6")) && flag(env, v)) a.push_back("--ipv6");
    static std::vector<char*> p; p.clear();
    for (auto& s : a) p.push_back(&s[0]);
    i2p::api::InitI2P((int)p.size(), p.data(), "i2pd");
    inited = true;
  }
  i2p::api::StartI2P();
  i2p::client::context.Start();
  running = true;
  return nullptr;
}

// Leaves i2pd's config and crypto initialised so start() can run again in this process.
static napi_value stop (napi_env env, napi_callback_info) {
  if (running) {
    i2p::client::context.Stop();
    i2p::api::StopI2P();
    running = false;
  }
  return nullptr;
}

static void set (napi_env env, napi_value obj, const char* name, double n) {
  napi_value v; napi_create_double(env, n, &v); napi_set_named_property(env, obj, name, v);
}

static napi_value status (napi_env env, napi_callback_info) {
  napi_value o; napi_create_object(env, &o);
  napi_value r; napi_get_boolean(env, running, &r); napi_set_named_property(env, o, "running", r);
  if (running) {
    napi_value s; napi_create_string_utf8(env, i2p::ROUTER_STATUS_NAMES[i2p::context.GetStatus()], NAPI_AUTO_LENGTH, &s);
    napi_set_named_property(env, o, "status", s);
    // i2pd logs and carries on when SAM can't bind its port: the caller must see it
    napi_value sam; napi_get_boolean(env, i2p::client::context.GetSAMBridge() != nullptr, &sam);
    napi_set_named_property(env, o, "sam", sam);
    set(env, o, "routers", i2p::data::netdb.GetNumRouters());
    set(env, o, "floodfills", i2p::data::netdb.GetNumFloodfills());
    set(env, o, "transit", (double)i2p::tunnel::tunnels.CountTransitTunnels());
    set(env, o, "transitBytes", (double)i2p::transport::transports.GetTotalTransitTransmittedBytes());
  }
  return o;
}

NAPI_MODULE_INIT() {
  napi_value f;
  napi_create_function(env, "start", NAPI_AUTO_LENGTH, start, nullptr, &f);
  napi_set_named_property(env, exports, "start", f);
  napi_create_function(env, "stop", NAPI_AUTO_LENGTH, stop, nullptr, &f);
  napi_set_named_property(env, exports, "stop", f);
  napi_create_function(env, "status", NAPI_AUTO_LENGTH, status, nullptr, &f);
  napi_set_named_property(env, exports, "status", f);
  return exports;
}
