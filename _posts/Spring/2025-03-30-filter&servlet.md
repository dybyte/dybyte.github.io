---
toc: true
title: "filter & servlet"
---
# filter & servlet

TokenProvider에서 토큰을 검증하는 과정에서 발생하는 에러들을 통일된 http 상태코드로 반환해야 하는 상황이었다. 그런데 토큰이 만료된 경우, 401 에러를 반환해야 하는데 500 에러가 반환되고 있었다.

TokenProvider

```java
public boolean validateToken(String token){
        try{
            Jwts.parserBuilder().setSigningKey(SECRET_KEY).build().parseClaimsJws(token);
            return true;
        }
        catch (io.jsonwebtoken.security.SecurityException | MalformedJwtException e){
            throw new FilterException(Code.JWT_INVALID_SIGN);
        }
        catch (ExpiredJwtException e){
            throw new FilterException(Code.JWT_EXPIRED);
        }
        ...
}
```

ExceptionHandler

```java

    @ExceptionHandler(FilterException.class)
    public ResponseEntity<ErrorResponseDto> handleFilterException(FilterException exception) {
        log.error(exception.getMessage() + " - " + exception.getCause());
        return ErrorResponseDto.of(Code.UNAUTHORIZED, exception);
    }

```

나는 TokenProvider에서 발생하는 예외를 잡아서 처리하기 위해 위와 같은 코드를 작성했다.

하지만 테스트 코드를 작성해보니 내가 원하는 방향으로 작동하지 않았고, 디버깅을 해보니 handleFilterException 메서드를 아예 거치지 않고 프로그램이 종료되는 것을 확인했다.

그 이유는, 이 Filter 에서 찾을 수 있었다.

## Filter

```java
@RequiredArgsConstructor
@Slf4j
public class JwtAuthenticationFilter extends GenericFilterBean {
    private final TokenProvider jwtTokenProvider;

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        // 1. Request Header에서 JWT 토큰 추출
        String token = resolveToken((HttpServletRequest) request);

        // 2. validateToken으로 토큰 유효성 검사
        try {
            if (token != null && jwtTokenProvider.validateToken(token)) {
                // 토큰이 유효할 경우 토큰에서 Authentication 객체를 가지고 와서 SecurityContext에 저장
                Authentication authentication = jwtTokenProvider.getAuthentication(token);
                SecurityContextHolder.getContext().setAuthentication(authentication);
            }

            chain.doFilter(request, response);
            
        } catch (FilterException e) {
            jwtExceptionHandler((HttpServletResponse) response, e);
        } catch (java.io.IOException e) {
            e.printStackTrace();
        } catch (ServletException e) {
            e.printStackTrace();
        }
    }
```

이것은 spring mvc와 별개로 동작하는 filter이다.

filter는 서블릿 컨테이너가 서블릿을 호출하기 전에 수행된다.

`@ExceptionHandler` 는 서블릿 범위 내에서 발생한 에러를 잡을 수 있다.

필터는 다음의 3가지 메서드로 구성된다.

- `init()` : 필터 초기화 메서드, 서블릿 컨테이너가 생성될 때 호출된다.
- `doFilter()` : 고객의 요청이 올 때 마다 해당 메서드가 호출된다. 필터의 로직을 구현하면 된다.

  doFilter() 메서드는 파라미터에 **filterchain**을 가지고 있는데, `filterchain.doFilter(request, response);` 메서드를 호출하게 되면,

  **다음 필터가 있으면 필터를 호출하고, 필터가 없으면 dispatcherServlet을 호출한다.**

  만약 이 로직을 호출하지 않으면 다음 단계로 진행되지 않기 때문에, 특별한 경우를 제외하고 **반드시 호출**해야한다.

- `destroy()` : 필터 종료 메서드, 서블릿 컨테이너가 종료될 때 호출된다.

## 서블릿 컨테이너의 실행 순서

1. 요청 수신
    1. 클라이언트로부터 HTTP 요청을 수신한다.
    2. 요청 URI와 HTTP 메서드(GET, POST 등) 정보를 분석한다.
2. 필터 체인 실행
    1. 요청이 Filter Chain에 전달되어 각 필터가 순차적으로 실행된다.
3. 서블릿 매핑 결정
    1. 요청 URI를 기반으로 어떤 서블릿이 요청을 처리할지 결정한다.
4. 서블릿 초기화 및 생성
    1. 요청을 처리할 서블릿 인스턴스가 이미 생성되어 있다면 재사용한다.
    2. 서블릿이 아직 초기화되지 않은 상태라면, 서블릿의 `init()` 메서드를 호출하여 초기화한다.
5. 스레드 생성 및 요청 전달
    1. 요청 처리를 위해 스레드를 생성하거나, 기존 스레드 풀에서 사용 가능한 스레드를 할당한다.
    2. 서블릿의 `service()` 메서드를 호출하여 요청을 전달한다.

filter에서 발생한 예외는 filter에서 잡아주어야 한다는 것을 알게되었다.

아래와 같이 직접 예외처리를 해주었다.

```java
 try {
           ...
       chain.doFilter(request, response);
            
     } catch (FilterException e) {
            jwtExceptionHandler((HttpServletResponse) response, e);
      } ...
```

```java
  public void jwtExceptionHandler(HttpServletResponse response, FilterException error) {
        response.setStatus(HttpStatus.UNAUTHORIZED.value());
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");
        try {
            String json = new ObjectMapper()
                    .writeValueAsString(new MessageResponseDto(
                            HttpStatus.UNAUTHORIZED.value(), error.getMessage()
                    ));
            response.getWriter().write(json);
        } catch (Exception e) {
            log.error(e.getMessage());
        }
    }
```