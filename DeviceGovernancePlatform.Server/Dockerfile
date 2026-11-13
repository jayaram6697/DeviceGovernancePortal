
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build

WORKDIR /src

COPY DeviceGovernancePlatform.Server.csproj ./

RUN dotnet restore DeviceGovernancePlatform.Server.csproj

COPY . .

RUN dotnet publish DeviceGovernancePlatform.Server.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final

WORKDIR /app

ENV ASPNETCORE_URLS=http://+:5080

EXPOSE 5080

COPY --from=build /app/publish .

ENTRYPOINT ["dotnet", "DeviceGovernancePlatform.Server.dll"]
