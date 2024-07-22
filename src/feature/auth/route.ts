import { Hono } from "hono";
import { getExpTimestamp, reverseGeocodingAPI } from "../../lib/utils";
import { prisma } from "../../lib/prisma";
import { zValidator } from "@hono/zod-validator";
import { geoLocationSchema, loginSchema, signupSchema } from "./schema";
import { HTTPException } from "hono/http-exception";
import { jwt, sign } from "hono/jwt";
import {
  ACCESS_TOKEN_COOKIE_NAME,
  ACCESS_TOKEN_EXP,
  REFRESH_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_EXP,
} from "../../config/constants";
import { setCookie, deleteCookie } from "hono/cookie";
import { isAuthenticated } from "../../middleware/auth";
import { env } from "../../config/env";
import { Variables } from "../../types";

const app = new Hono<{ Variables: Variables }>();

app.post("/login", zValidator("json", loginSchema), async (c) => {
  const body = c.req.valid("json");

  // match user email
  const user = await prisma.user.findUnique({
    where: { email: body.email },
  });

  if (!user) {
    throw new HTTPException(400, {
      message: "The email address or password you entered is incorrect",
    });
  }

  // match password
  const matchPassword = await Bun.password.verify(
    body.password,
    user.password,
    "bcrypt"
  );
  if (!matchPassword) {
    throw new HTTPException(400, {
      message: "The email address or password you entered is incorrect",
    });
  }

  // create access token
  const accessToken = await sign(
    {
      exp: getExpTimestamp(ACCESS_TOKEN_EXP),
      sub: user.id,
    },
    env.JWT_ACEESS_TOKEN_SECRET
  );

  // create refresh token
  const refreshToken = await sign(
    {
      exp: getExpTimestamp(REFRESH_TOKEN_EXP),
      sub: user.id,
    },
    env.JWT_REFRESH_TOKEN_SECRET
  );
  setCookie(c, ACCESS_TOKEN_COOKIE_NAME, accessToken, {
    httpOnly: true,
    path: "/",
    maxAge: ACCESS_TOKEN_EXP,
  });
  setCookie(c, REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    path: "/",
    maxAge: REFRESH_TOKEN_EXP,
  });
  return c.json({
    success: true,
    message: "Login successfully",
    data: {
      accessToken,
      refreshToken,
    },
  });
});

app.post("/signup", zValidator("json", signupSchema), async (c) => {
  const body = c.req.valid("json");
  // hash password
  const password = await Bun.password.hash(body.password, {
    algorithm: "bcrypt",
    cost: 10,
  });

  // fetch user location from lat & lon
  let location;
  if (body.location && body.location.length === 2) {
    const [lat, lon] = body.location;
    const locationResp = await reverseGeocodingAPI(lat, lon);
    location = geoLocationSchema.parse(locationResp);
  }

  const user = await prisma.user.create({
    data: {
      email: body.email,
      name: body.name,
      password,
      location,
    },
  });

  return c.json({
    success: true,
    message: "Account created successfully",
    data: {
      user,
    },
  });
});

app.post("/logout", (c) => {
  deleteCookie(c, ACCESS_TOKEN_COOKIE_NAME);
  deleteCookie(c, REFRESH_TOKEN_COOKIE_NAME);
  return c.json({
    success: true,
    message: "Logout successfully",
  });
});

app.get(
  "/me",
  jwt({
    cookie: ACCESS_TOKEN_COOKIE_NAME,
    secret: env.JWT_ACEESS_TOKEN_SECRET,
  }),
  isAuthenticated,
  async (c) => {
    const currentUser = c.get("user");
    const user = await prisma.user.findUnique({
      where: {
        id: currentUser.id,
      },
    });
    if (!user) {
      throw new HTTPException(404, {
        message: "User not found",
      });
    }
    return c.json({
      success: true,
      message: "Fetch current user",
      data: {
        user,
      },
    });
  }
);

app.get(
  "/refresh",
  jwt({ secret: env.JWT_REFRESH_TOKEN_SECRET, cookie: "refreshToken" }),
  async (c) => {
    const jwtPayload = c.get("jwtPayload");

    // create access token
    const accessToken = await sign(
      {
        exp: getExpTimestamp(ACCESS_TOKEN_EXP),
        sub: jwtPayload.sub,
      },
      env.JWT_ACEESS_TOKEN_SECRET
    );

    // create refresh token
    const refreshToken = await sign(
      {
        exp: getExpTimestamp(REFRESH_TOKEN_EXP),
        sub: jwtPayload.sub,
      },
      env.JWT_REFRESH_TOKEN_SECRET
    );
    setCookie(c, ACCESS_TOKEN_COOKIE_NAME, accessToken, {
      httpOnly: true,
      path: "/",
      maxAge: ACCESS_TOKEN_EXP,
    });
    setCookie(c, REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      path: "/",
      maxAge: REFRESH_TOKEN_EXP,
    });
    return c.json({
      success: true,
      message: "Access & refresh token created",
      data: {
        accessToken,
        refreshToken,
      },
    });
  }
);
export default app;
