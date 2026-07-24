ALTER TABLE "users"
  ALTER COLUMN "weather_location" TYPE jsonb
  USING CASE
    WHEN "weather_location" IS NULL THEN NULL
    ELSE jsonb_build_object('label', "weather_location")
  END;
