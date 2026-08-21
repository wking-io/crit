import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  Id,
  RepresentationRef,
  RootedRoute,
  decodeRepresentationRef
} from "../src/index.js"

const digest = `sha256:${"a".repeat(64)}`

const representations = [
  {
    _tag: "application-route",
    applicationId: "application_storefront",
    route: "/checkout?variant=b&variant=a",
    state: {
      cart: {
        items: [
          { id: "sku_1", quantity: 2 },
          null,
          true,
          4.5
        ]
      },
      coupon: "SUMMER"
    }
  },
  {
    _tag: "web-url",
    url: "https://example.com/review?build=42"
  },
  {
    _tag: "artifact",
    artifactId: "artifact_checkout",
    digest
  }
] as const

describe("RepresentationRef", () => {
  it.each(representations)("round-trips $_tag through JSON", (input) => {
    const decoded = decodeRepresentationRef(
      JSON.parse(JSON.stringify(input))
    )
    const encoded = Schema.encodeSync(RepresentationRef)(decoded)
    expect(JSON.parse(JSON.stringify(encoded))).toEqual(input)
  })

  it("constructs typed logical references from validated values", () => {
    const representation: RepresentationRef = {
      _tag: "application-route",
      applicationId: Id.application("application_storefront"),
      route: Schema.decodeUnknownSync(RootedRoute)("/checkout")
    }
    expect(representation._tag).toBe("application-route")
  })

  it("preserves query order and duplicate keys as logical identity", () => {
    const first = decodeRepresentationRef({
      _tag: "application-route",
      applicationId: "application_storefront",
      route: "/search?tag=b&tag=a"
    })
    const second = decodeRepresentationRef({
      _tag: "application-route",
      applicationId: "application_storefront",
      route: "/search?tag=a&tag=b"
    })
    expect(first.route).toBe("/search?tag=b&tag=a")
    expect(second.route).toBe("/search?tag=a&tag=b")
    expect(first.route).not.toBe(second.route)
  })

  it.each([
    "",
    "checkout",
    "./checkout",
    "https://example.com/checkout",
    "//example.com/checkout",
    "/checkout#payment",
    "/checkout\\payment",
    "/check out",
    "/checkout\n",
    "/checkout?",
    "/checkout/",
    "/checkout//payment",
    "/checkout/./payment",
    "/checkout/../payment",
    "/checkout/%2e/payment",
    "/checkout/%2Fpayment",
    "/checkout/%5csettings",
    "/checkout/%zz",
    "/café",
    "/emoji/😀",
    "/search?q=café",
    "/checkout/%25",
    "/checkout/%252F",
    "/search?q=%25",
    "/checkout/%c3%A9",
    "/checkout/%C3%a9",
    "/search?q=%c3%A9",
    "/search?q=%C3%a9"
  ])("rejects non-canonical route %j", (route) => {
    expect(() => decodeRepresentationRef({
      _tag: "application-route",
      applicationId: "application_storefront",
      route
    })).toThrow()
  })

  it.each([
    ["/A", "/%41"],
    ["/a", "/%61"],
    ["/1", "/%31"],
    ["/-", "/%2D"],
    ["/_", "/%5F"],
    ["/~", "/%7E"],
    ["/search?q=A", "/search?q=%41"],
    ["/search?q=~", "/search?q=%7E"]
  ])("accepts literal route %s and rejects equivalent escape %s", (
    literal,
    escaped
  ) => {
    expect(decodeRepresentationRef({
      _tag: "application-route",
      applicationId: "application_storefront",
      route: literal
    }).route).toBe(literal)
    expect(() => decodeRepresentationRef({
      _tag: "application-route",
      applicationId: "application_storefront",
      route: escaped
    })).toThrow()
  })

  it.each([
    ["/:value", "/%3Avalue"],
    ["/@value", "/%40value"],
    ["/!value", "/%21value"],
    ["/$value", "/%24value"],
    ["/&value", "/%26value"],
    ["/'value", "/%27value"],
    ["/(value)", "/%28value%29"],
    ["/*value", "/%2Avalue"],
    ["/+value", "/%2Bvalue"],
    ["/,value", "/%2Cvalue"],
    ["/;value", "/%3Bvalue"],
    ["/=value", "/%3Dvalue"],
    ["/search?q=?", "/search?q=%3F"],
    ["/search?q=/", "/search?q=%2F"]
  ])("keeps printable ASCII literal in %s and rejects alias %s", (
    literal,
    escaped
  ) => {
    expect(decodeRepresentationRef({
      _tag: "application-route",
      applicationId: "application_storefront",
      route: literal
    }).route).toBe(literal)
    expect(() => decodeRepresentationRef({
      _tag: "application-route",
      applicationId: "application_storefront",
      route: escaped
    })).toThrow()
  })

  it.each([
    "/caf%C3%A9",
    "/emoji/%F0%9F%98%80",
    "/search?q=caf%C3%A9"
  ])("accepts canonical uppercase percent route %s", (route) => {
    expect(decodeRepresentationRef({
      _tag: "application-route",
      applicationId: "application_storefront",
      route
    }).route).toBe(route)
  })

  it.each([
    "/invalid/%80",
    "/invalid/%C0%AF",
    "/invalid/%E0%80%AF",
    "/invalid/%F0%80%80%AF",
    "/invalid/%ED%A0%80",
    "/invalid/%F4%90%80%80",
    "/invalid/%E2%28%A1",
    "/invalid/%C2",
    "/invalid/%E2%82",
    "/invalid/%F5%80%80%80",
    "/invalid/%FF",
    "/search?q=%E2%82"
  ])("rejects malformed UTF-8 route %s", (route) => {
    expect(() => decodeRepresentationRef({
      _tag: "application-route",
      applicationId: "application_storefront",
      route
    })).toThrow()
  })

  it.each([
    "http://localhost:3000/checkout",
    "http://app.localhost/checkout",
    "http://127.0.0.1/checkout",
    "http://0.0.0.0/checkout",
    "http://[::1]/checkout",
    "http://0:0:0:0:0:0:0:1/checkout",
    "http://::ffff:127.0.0.1/checkout",
    "http://2130706433/checkout",
    "http://0177.0.0.1/checkout",
    "http://0x7f.0x0.0x0.0x1/checkout",
    "http://localhost./checkout",
    "http://app.localhost./checkout",
    "https://Example.com/checkout",
    "https://EXAMPLE.COM/checkout",
    "https://example/checkout",
    "https://-bad.example/checkout",
    "https://bad-.example/checkout",
    "https://bad_label.example/checkout",
    "https://example..com/checkout",
    "https://example.com./checkout",
    "https://example.com:0443/checkout",
    "https://example.com:443/checkout",
    "https://example.com:0/checkout",
    "https://example.com:65536/checkout",
    "https://user:secret@example.com/checkout"
  ])("rejects non-canonical or non-DNS web URL %j", (url) => {
    expect(() => decodeRepresentationRef({ _tag: "web-url", url })).toThrow()
  })

  it.each([
    "https://example.com",
    "https://review.example.com:8443/path?q=1#section",
    "https://xn--bcher-kva.example/review"
  ])("accepts canonical public DNS web URL %j", (url) => {
    expect(decodeRepresentationRef({ _tag: "web-url", url }).url).toBe(url)
  })

  it.each([
    { binding: { baseUrl: "http://localhost:3000" } },
    { deploymentUrl: "https://preview.example.com" },
    { credential: "secret" },
    { iframePolicy: "allow-scripts" },
    { bridgeState: { ready: true } },
    { renderPlan: { kind: "iframe" } },
    { snapshot: { artifactId: "artifact_checkout" } },
    { url: "https://alpha.example.com" }
  ])("rejects forbidden application-route field %#", (extra) => {
    expect(() => decodeRepresentationRef({
      _tag: "application-route",
      applicationId: "application_storefront",
      route: "/checkout",
      ...extra
    })).toThrow()
  })

  it("rejects excess fields on every variant", () => {
    expect(() => decodeRepresentationRef({
      _tag: "web-url",
      url: "https://example.com",
      iframePolicy: "allow-scripts"
    })).toThrow()
    expect(() => decodeRepresentationRef({
      _tag: "artifact",
      artifactId: "artifact_checkout",
      digest,
      deploymentUrl: "https://preview.example.com"
    })).toThrow()
  })

  it.each([
    undefined,
    { nested: undefined },
    ["valid", undefined],
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1n,
    () => "state"
  ])("rejects non-JSON page state %#", (state) => {
    expect(() => decodeRepresentationRef({
      _tag: "application-route",
      applicationId: "application_storefront",
      route: "/checkout",
      state
    })).toThrow()
  })

  it("rejects malformed IDs and artifact digests", () => {
    expect(() => decodeRepresentationRef({
      _tag: "application-route",
      applicationId: "storefront",
      route: "/checkout"
    })).toThrow()
    expect(() => decodeRepresentationRef({
      _tag: "artifact",
      artifactId: "checkout",
      digest
    })).toThrow()
    expect(() => decodeRepresentationRef({
      _tag: "artifact",
      artifactId: "artifact_checkout",
      digest: `sha256:${"A".repeat(64)}`
    })).toThrow()
  })

  it("rejects unknown and hybrid variants", () => {
    expect(() => decodeRepresentationRef({
      _tag: "deployment",
      url: "https://preview.example.com"
    })).toThrow()
    expect(() => decodeRepresentationRef({
      _tag: "artifact",
      artifactId: "artifact_checkout",
      digest,
      applicationId: "application_storefront",
      route: "/checkout"
    })).toThrow()
  })
})
